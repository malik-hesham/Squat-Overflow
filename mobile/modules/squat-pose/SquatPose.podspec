require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "SquatPose"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = "https://github.com/malik-hesham/Squat-Overflow"
  s.license      = package["license"]
  s.authors      = "Squat Overflow"
  s.platforms    = { :ios => min_ios_version_supported }
  s.source       = { :git => "https://github.com/malik-hesham/Squat-Overflow.git", :tag => "#{s.version}" }

  s.source_files = [
    "ios/**/*.{swift}",
    "ios/**/*.{m,mm}",
  ]
  # The pose model, the same file the Python server uses (server/models).
  s.resources = ["assets/pose_landmarker_lite.task"]
  s.frameworks = ["AVFoundation", "CoreMedia", "UIKit"]

  load 'nitrogen/generated/ios/SquatPose+autolinking.rb'
  add_nitrogen_files(s)

  s.dependency 'MediaPipeTasksVision', '1.0.0'
  s.dependency 'VisionCamera'
  s.dependency 'React-jsi'
  s.dependency 'React-callinvoker'
  install_modules_dependencies(s)
end
