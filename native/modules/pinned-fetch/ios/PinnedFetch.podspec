# The local Expo module behind pinned HTTPS requests (see ../index.ts).
# Autolinked from ../expo-module.config.json — there is no npm package here.

Pod::Spec.new do |s|
  s.name           = 'PinnedFetch'
  s.version        = '1.0.0'
  s.summary        = 'HTTPS with the server key pinned, instead of CA validation'
  s.description    = 'Performs one HTTPS request whose server certificate is trusted only when the SHA-256 of its SubjectPublicKeyInfo matches the caller-supplied pin.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  # CryptoKit is iOS 13+; 15.1 matches the app's own target.
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,swift}"
end
