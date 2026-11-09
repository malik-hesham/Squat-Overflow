//
//  HybridPoseDetector.swift
//  SquatPose
//
//  MediaPipe Pose Landmarker (the same pose_landmarker_lite model the extension
//  runs in the browser) on Vision Camera frames. Landmarks come back for the
//  upright, unmirrored camera image, like the extension's webcam frames,
//  so left and right mean the same thing in the shared analysis code.
//

import Foundation
import MediaPipeTasksVision
import NitroModules
import QuartzCore
import UIKit
import VisionCamera

final class HybridPoseDetector: HybridPoseDetectorSpec {
  private var video: PoseLandmarker?
  private var still: PoseLandmarker?
  private var lastTimestamp = -1
  private let lock = NSLock()

  override init() {
    super.init()
  }

  func detect(frame: any HybridFrameSpec) throws -> PoseResult? {
    guard let native = frame as? any NativeFrame else {
      throw RuntimeError.error(withMessage: "Frame is not a NativeFrame")
    }
    guard let buffer = native.sampleBuffer else {
      throw RuntimeError.error(withMessage: "Frame has no CMSampleBuffer (already disposed?)")
    }
    // Only the rotation is applied, never the selfie mirror: MediaPipe doesn't
    // take mirrored orientations, and the analysis expects true camera frames.
    let orientation = frame.orientation.uprightImageOrientation
    let image = try MPImage(sampleBuffer: buffer, orientation: orientation)
    let size = uprightSize(width: frame.width, height: frame.height, orientation: orientation)

    lock.lock()
    defer { lock.unlock() }
    if video == nil {
      video = try Self.makeLandmarker(mode: .video)
    }
    // VIDEO mode needs strictly increasing timestamps.
    let timestamp = max(Int(CACurrentMediaTime() * 1000), lastTimestamp + 1)
    lastTimestamp = timestamp
    let started = CACurrentMediaTime()
    let result = try video!.detect(videoFrame: image, timestampInMilliseconds: timestamp)
    return Self.toPoseResult(result, size: size, inferenceMs: (CACurrentMediaTime() - started) * 1000)
  }

  func detectImageFile(path: String) throws -> PoseResult? {
    let url = path.hasPrefix("file://") ? URL(string: path)! : URL(fileURLWithPath: path)
    guard let uiImage = UIImage(contentsOfFile: url.path) else {
      throw RuntimeError.error(withMessage: "Couldn't read an image at \(path)")
    }
    let image = try MPImage(uiImage: uiImage)
    lock.lock()
    defer { lock.unlock() }
    if still == nil {
      still = try Self.makeLandmarker(mode: .image)
    }
    let started = CACurrentMediaTime()
    let result = try still!.detect(image: image)
    let size = (Double(uiImage.size.width * uiImage.scale), Double(uiImage.size.height * uiImage.scale))
    return Self.toPoseResult(result, size: size, inferenceMs: (CACurrentMediaTime() - started) * 1000)
  }

  func close() throws {
    lock.lock()
    defer { lock.unlock() }
    video = nil
    still = nil
    lastTimestamp = -1
  }

  // MARK: - Helpers

  private func uprightSize(width: Double, height: Double, orientation: UIImage.Orientation) -> (Double, Double) {
    switch orientation {
    case .left, .right, .leftMirrored, .rightMirrored:
      return (height, width)
    default:
      return (width, height)
    }
  }

  private static func modelPath() throws -> String {
    // The podspec ships the model as a resource of this pod.
    for bundle in [Bundle(for: HybridPoseDetector.self), Bundle.main] {
      if let path = bundle.path(forResource: "pose_landmarker_lite", ofType: "task") {
        return path
      }
    }
    throw RuntimeError.error(withMessage: "pose_landmarker_lite.task is missing from the app bundle")
  }

  // Same settings as the server's PoseEngine (server/pose_engine.py), minus
  // segmentation masks: the phone blurs the whole preview instead.
  private static func makeLandmarker(mode: RunningMode) throws -> PoseLandmarker {
    let options = PoseLandmarkerOptions()
    options.baseOptions.modelAssetPath = try modelPath()
    options.runningMode = mode
    options.numPoses = 1
    options.minPoseDetectionConfidence = 0.5
    options.minPosePresenceConfidence = 0.5
    options.minTrackingConfidence = 0.5
    options.shouldOutputSegmentationMasks = false
    return try PoseLandmarker(options: options)
  }

  private static func toPoseResult(_ result: PoseLandmarkerResult, size: (Double, Double), inferenceMs: Double) -> PoseResult? {
    guard let pose = result.landmarks.first, !pose.isEmpty else { return nil }
    var landmarks: [Double] = []
    landmarks.reserveCapacity(pose.count * 3)
    for lm in pose {
      landmarks.append(Double(lm.x))
      landmarks.append(Double(lm.y))
      landmarks.append(lm.visibility?.doubleValue ?? 1.0)
    }
    var world: [Double] = []
    if let worldPose = result.worldLandmarks.first {
      world.reserveCapacity(worldPose.count * 3)
      for lm in worldPose {
        world.append(Double(lm.x))
        world.append(Double(lm.y))
        world.append(Double(lm.z))
      }
    }
    return PoseResult(landmarks: landmarks, world: world, width: size.0, height: size.1, inferenceMs: inferenceMs)
  }
}

private extension CameraOrientation {
  // Vision Camera's orientation follows UIImage.Orientation, like ML Kit's.
  var uprightImageOrientation: UIImage.Orientation {
    switch self {
    case .up: return .up
    case .down: return .down
    case .left: return .left
    case .right: return .right
    }
  }
}
