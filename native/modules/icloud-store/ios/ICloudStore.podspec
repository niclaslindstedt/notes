# The local Expo module behind the iCloud Drive storage backend (see
# ../index.ts). Autolinked from ../expo-module.config.json — there is no npm
# package here.

Pod::Spec.new do |s|
  s.name           = 'ICloudStore'
  s.version        = '1.0.0'
  s.summary        = 'Reads and writes the app iCloud Drive container'
  s.description    = 'A small file store — list, read, write, remove — inside the app own iCloud Drive ubiquity container.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  # Matches the app's own deployment target.
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
