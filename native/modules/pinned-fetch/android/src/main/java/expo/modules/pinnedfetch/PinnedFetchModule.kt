// The Android half of `PinnedFetch` (see ../index.ts for the JS contract and
// ../../../README.md for where it sits in the bridge).
//
// One HTTPS request whose server certificate is trusted **iff** the SHA-256 of
// its SubjectPublicKeyInfo equals the caller's pin. The system CA store is not
// consulted: a notesd daemon presents a self-signed certificate, so CA
// validation would reject exactly the certificate we want and accept any
// certificate a public CA happened to issue for the host. The pin is the
// identity — which is also why the hostname is not checked (see the verifier
// below).
//
// `getPublicKey().encoded` is already the DER SubjectPublicKeyInfo here, so
// unlike the Apple side there is no algorithm header to put back: both
// platforms hash the same bytes.

package expo.modules.pinnedfetch

import android.util.Base64
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager

class PinnedRequest : Record {
  @Field var url: String = ""
  @Field var method: String = "GET"
  @Field var headers: Map<String, String> = emptyMap()
  /** base64, or null for bodyless methods. */
  @Field var bodyBase64: String? = null
  /** `sha256:<base64>` or the bare base64 digest. */
  @Field var spkiPin: String = ""
}

private class PinnedFetchException(message: String) :
  CodedException("ERR_PINNED_FETCH", message, null)

class PinnedFetchModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PinnedFetch")

    // Blocking IO: AsyncFunction runs off the main thread.
    AsyncFunction("request") { request: PinnedRequest ->
      val pin = decodePin(request.spkiPin)
      val connection = open(URL(request.url), pin)

      try {
        connection.requestMethod = request.method.uppercase()
        for ((name, value) in request.headers) {
          connection.setRequestProperty(name, value)
        }

        request.bodyBase64?.let { body ->
          val bytes =
            try {
              Base64.decode(body, Base64.DEFAULT)
            } catch (e: IllegalArgumentException) {
              throw PinnedFetchException("The request body is not valid base64.")
            }
          connection.doOutput = true
          connection.setFixedLengthStreamingMode(bytes.size)
          connection.outputStream.use { it.write(bytes) }
        }

        val status = connection.responseCode
        // 4xx/5xx bodies arrive on the error stream, and they carry the
        // daemon's own explanation — which is the thing worth reading.
        val body =
          (if (status >= 400) connection.errorStream else connection.inputStream)
            ?.use { it.readBytes() }

        val headers = mutableMapOf<String, String>()
        for ((name, values) in connection.headerFields) {
          // The status line comes back under a null key.
          if (name != null && values.isNotEmpty()) {
            headers[name] = values.joinToString(", ")
          }
        }

        mapOf(
          "status" to status,
          "statusText" to (connection.responseMessage ?: ""),
          "headers" to headers,
          "bodyBase64" to
            body?.takeIf { it.isNotEmpty() }?.let {
              Base64.encodeToString(it, Base64.NO_WRAP)
            },
        )
      } finally {
        connection.disconnect()
      }
    }
  }

  /** `sha256:<base64>` or a bare base64 digest → the 32 raw bytes. */
  private fun decodePin(pin: String): ByteArray {
    val body = pin.removePrefix("sha256:").trim()
    val bytes =
      try {
        Base64.decode(body, Base64.DEFAULT)
      } catch (e: IllegalArgumentException) {
        throw PinnedFetchException("The SPKI pin is not valid base64.")
      }
    if (bytes.size != 32) {
      throw PinnedFetchException("The SPKI pin is not a SHA-256 digest.")
    }
    return bytes
  }

  private fun open(url: URL, pin: ByteArray): HttpURLConnection {
    val connection =
      url.openConnection() as? HttpsURLConnection
        ?: throw PinnedFetchException("A pinned request must be https.")

    val context = SSLContext.getInstance("TLS")
    context.init(null, arrayOf(PinOnlyTrustManager(pin)), SecureRandom())
    connection.sslSocketFactory = context.socketFactory
    // The pin has already decided which key is acceptable. A daemon's
    // certificate is issued for whatever address it happens to be reachable
    // at, so a name check here would reject the right key for the wrong
    // reason.
    connection.hostnameVerifier = javax.net.ssl.HostnameVerifier { _, _ -> true }
    return connection
  }
}

/** Trusts exactly one public key, and nothing else. */
private class PinOnlyTrustManager(private val expected: ByteArray) : X509TrustManager {
  override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
    val leaf =
      chain?.firstOrNull()
        ?: throw CertificateException("The server presented no certificate.")
    val digest = MessageDigest.getInstance("SHA-256").digest(leaf.publicKey.encoded)
    if (!MessageDigest.isEqual(digest, expected)) {
      throw CertificateException(
        "The server's certificate does not match the pinned public key."
      )
    }
  }

  // This trust manager is only ever installed on an outgoing client
  // connection; it is never asked to vouch for a client.
  override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {
    throw CertificateException("Client certificates are not accepted.")
  }

  override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
}
