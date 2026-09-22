// The Apple half of `PinnedFetch` (see ../index.ts for the JS contract and
// ../../../README.md for where it sits in the bridge).
//
// One HTTPS request whose server certificate is trusted **iff** the SHA-256 of
// its SubjectPublicKeyInfo equals the caller's pin. The system CA store is not
// consulted at all: a notesd daemon presents a self-signed certificate, so CA
// validation would fail on a certificate that is exactly the one we want, and
// pass on any certificate a public CA happened to issue for the host. The pin
// is the identity; the hostname and the chain are not.
//
// WHY THE ASN.1 HEADERS BELOW. The pin is over the DER SubjectPublicKeyInfo —
// what every pinning tool prints, and what Java's `getPublicKey().getEncoded()`
// returns on the Android side, so both platforms hash the same bytes. Security
// framework hands back the *raw* key instead (a PKCS#1 RSAPublicKey, or an
// uncompressed EC point), so the algorithm identifier that SPKI wraps it in
// has to be put back before hashing. The headers are constant per key type and
// size, which is why a table of four covers every certificate we issue.

import CryptoKit
import ExpoModulesCore

/// The request as the JS side spells it.
struct PinnedRequestRecord: Record {
  @Field var url: String = ""
  @Field var method: String = "GET"
  @Field var headers: [String: String] = [:]
  /// base64, or nil for bodyless methods.
  @Field var bodyBase64: String?
  /// `sha256:<base64>` or the bare base64 digest.
  @Field var spkiPin: String = ""
}

/// Errors that reach JS as a rejected promise.
private enum PinnedFetchError: String {
  case badUrl = "The request URL is not valid."
  case badPin = "The SPKI pin is not valid base64."
  case badBody = "The request body is not valid base64."
  case pinMismatch =
    "The server's certificate does not match the pinned public key."
  case noResponse = "The server closed the connection without responding."
}

private func fail(_ error: PinnedFetchError) -> Exception {
  Exception(name: "ERR_PINNED_FETCH", description: error.rawValue)
}

public final class PinnedFetchModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PinnedFetch")

    AsyncFunction("request") { (request: PinnedRequestRecord, promise: Promise) in
      guard let url = URL(string: request.url) else {
        promise.reject(fail(.badUrl))
        return
      }
      guard let pin = Self.decodePin(request.spkiPin) else {
        promise.reject(fail(.badPin))
        return
      }

      var urlRequest = URLRequest(url: url)
      urlRequest.httpMethod = request.method
      for (name, value) in request.headers {
        urlRequest.setValue(value, forHTTPHeaderField: name)
      }
      if let bodyBase64 = request.bodyBase64 {
        guard let body = Data(base64Encoded: bodyBase64) else {
          promise.reject(fail(.badBody))
          return
        }
        urlRequest.httpBody = body
      }

      // The delegate holds the pin, so the session is per-request. It is
      // invalidated in the completion handler: a URLSession keeps a strong
      // reference to its delegate until it is, and that would leak one session
      // per request.
      let delegate = PinnedSessionDelegate(expected: pin)
      let session = URLSession(
        configuration: .ephemeral, delegate: delegate, delegateQueue: nil
      )

      let task = session.dataTask(with: urlRequest) { data, response, error in
        defer { session.finishTasksAndInvalidate() }

        if let error {
          // A pin mismatch surfaces as a cancelled TLS handshake. Say which it
          // was: "cancelled" on its own sends the caller looking at their
          // network rather than at the pin they pasted.
          if delegate.rejectedForPin {
            promise.reject(fail(.pinMismatch))
          } else {
            promise.reject(
              Exception(
                name: "ERR_PINNED_FETCH", description: error.localizedDescription
              )
            )
          }
          return
        }
        guard let http = response as? HTTPURLResponse else {
          promise.reject(fail(.noResponse))
          return
        }

        var headers: [String: String] = [:]
        for (key, value) in http.allHeaderFields {
          if let key = key as? String, let value = value as? String {
            headers[key] = value
          }
        }

        promise.resolve([
          "status": http.statusCode,
          "statusText": HTTPURLResponse.localizedString(
            forStatusCode: http.statusCode
          ),
          "headers": headers,
          "bodyBase64": (data?.isEmpty == false)
            ? data?.base64EncodedString() : nil,
        ])
      }
      task.resume()
    }
  }

  /// `sha256:<base64>` or a bare base64 digest → the 32 raw bytes.
  private static func decodePin(_ pin: String) -> Data? {
    let body = pin.hasPrefix("sha256:") ? String(pin.dropFirst(7)) : pin
    guard let data = Data(base64Encoded: body.trimmingCharacters(in: .whitespaces)),
      data.count == 32
    else {
      return nil
    }
    return data
  }
}

/// Trusts exactly one public key, and nothing else.
private final class PinnedSessionDelegate: NSObject, URLSessionDelegate {
  private let expected: Data
  /// Set when the handshake was refused because the key did not match, so the
  /// completion handler can say so instead of reporting a cancelled request.
  private(set) var rejectedForPin = false

  init(expected: Data) {
    self.expected = expected
  }

  func urlSession(
    _ session: URLSession,
    didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping (
      URLSession.AuthChallengeDisposition, URLCredential?
    ) -> Void
  ) {
    guard
      challenge.protectionSpace.authenticationMethod
        == NSURLAuthenticationMethodServerTrust,
      let trust = challenge.protectionSpace.serverTrust,
      let leaf = Self.leafCertificate(of: trust),
      let spki = Self.subjectPublicKeyInfo(of: leaf)
    else {
      rejectedForPin = true
      completionHandler(.cancelAuthenticationChallenge, nil)
      return
    }

    // Constant-time compare: both operands are 32 bytes and public, so this is
    // belt and braces rather than load-bearing.
    let digest = Data(SHA256.hash(data: spki))
    guard digest.count == expected.count,
      zip(digest, expected).reduce(0, { $0 | ($1.0 ^ $1.1) }) == 0
    else {
      rejectedForPin = true
      completionHandler(.cancelAuthenticationChallenge, nil)
      return
    }

    completionHandler(.useCredential, URLCredential(trust: trust))
  }

  private static func leafCertificate(of trust: SecTrust) -> SecCertificate? {
    if #available(iOS 15.0, macOS 12.0, *) {
      return (SecTrustCopyCertificateChain(trust) as? [SecCertificate])?.first
    }
    return SecTrustGetCertificateAtIndex(trust, 0)
  }

  /// The DER SubjectPublicKeyInfo — the raw key with its algorithm identifier
  /// put back in front. Nil for a key type we have no header for, which fails
  /// the pin rather than hashing something that is not an SPKI.
  private static func subjectPublicKeyInfo(of certificate: SecCertificate) -> Data? {
    guard let key = SecCertificateCopyKey(certificate),
      let raw = SecKeyCopyExternalRepresentation(key, nil) as Data?,
      let attributes = SecKeyCopyAttributes(key) as? [CFString: Any],
      let type = attributes[kSecAttrKeyType] as? String,
      let bits = attributes[kSecAttrKeySizeInBits] as? Int,
      let header = asn1Header(type: type, bits: bits)
    else {
      return nil
    }
    return header + raw
  }

  private static func asn1Header(type: String, bits: Int) -> Data? {
    switch (type, bits) {
    case (kSecAttrKeyTypeRSA as String, 2048):
      return Data([
        0x30, 0x82, 0x01, 0x22, 0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86,
        0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00, 0x03, 0x82, 0x01, 0x0f, 0x00,
      ])
    case (kSecAttrKeyTypeRSA as String, 4096):
      return Data([
        0x30, 0x82, 0x02, 0x22, 0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86,
        0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00, 0x03, 0x82, 0x02, 0x0f, 0x00,
      ])
    case (kSecAttrKeyTypeECSECPrimeRandom as String, 256):
      return Data([
        0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02,
        0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03,
        0x42, 0x00,
      ])
    case (kSecAttrKeyTypeECSECPrimeRandom as String, 384):
      return Data([
        0x30, 0x76, 0x30, 0x10, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02,
        0x01, 0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x22, 0x03, 0x62, 0x00,
      ])
    default:
      return nil
    }
  }
}
