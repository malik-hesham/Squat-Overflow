package com.margelo.nitro.squatpose

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.os.SystemClock
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarker
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarkerResult
import com.margelo.nitro.NitroModules
import com.margelo.nitro.camera.HybridFrameSpec
import com.margelo.nitro.camera.public.NativeFrame
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * MediaPipe Pose Landmarker (the same pose_landmarker_lite model the Python
 * pose server uses) on Vision Camera frames. Landmarks come back for the
 * upright, unmirrored camera image, like the webcam frames the server analysed,
 * so left and right mean the same thing in the shared analysis code.
 */
class HybridPoseDetector : HybridPoseDetectorSpec() {
  private var video: PoseLandmarker? = null
  private var still: PoseLandmarker? = null
  private var lastTimestamp = -1L
  private val lock = Any()

  override fun detect(frame: HybridFrameSpec): PoseResult? {
    val native = frame as? NativeFrame ?: throw Error("Frame is not a NativeFrame")
    val proxy = native.image
    // Only the rotation is applied, never the selfie mirror: the analysis
    // expects true camera frames.
    val bitmap = upright(proxy.toBitmap(), proxy.imageInfo.rotationDegrees)
    val image = BitmapImageBuilder(bitmap).build()
    synchronized(lock) {
      val landmarker = video ?: create(RunningMode.VIDEO).also { video = it }
      // VIDEO mode needs strictly increasing timestamps.
      val timestamp = maxOf(SystemClock.uptimeMillis(), lastTimestamp + 1)
      lastTimestamp = timestamp
      val started = SystemClock.elapsedRealtimeNanos()
      val result = landmarker.detectForVideo(image, timestamp)
      val ms = (SystemClock.elapsedRealtimeNanos() - started) / 1e6
      return toPoseResult(result, bitmap.width.toDouble(), bitmap.height.toDouble(), ms)
    }
  }

  override fun detectImageFile(path: String): PoseResult? {
    val file = path.removePrefix("file://")
    val bitmap = BitmapFactory.decodeFile(file) ?: throw Error("Couldn't read an image at $path")
    val image = BitmapImageBuilder(bitmap).build()
    synchronized(lock) {
      val landmarker = still ?: create(RunningMode.IMAGE).also { still = it }
      val started = SystemClock.elapsedRealtimeNanos()
      val result = landmarker.detect(image)
      val ms = (SystemClock.elapsedRealtimeNanos() - started) / 1e6
      return toPoseResult(result, bitmap.width.toDouble(), bitmap.height.toDouble(), ms)
    }
  }

  override fun close() {
    synchronized(lock) {
      video?.close()
      still?.close()
      video = null
      still = null
      lastTimestamp = -1L
    }
  }

  override fun dispose() {
    close()
    super.dispose()
  }

  private fun upright(bitmap: Bitmap, rotationDegrees: Int): Bitmap {
    if (rotationDegrees % 360 == 0) return bitmap
    val matrix = Matrix().apply { postRotate(rotationDegrees.toFloat()) }
    return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
  }

  // Read the model ourselves so asset compression can't get in the way.
  private fun modelBuffer(): ByteBuffer {
    val context = NitroModules.applicationContext ?: throw Error("No React context yet")
    val bytes = context.assets.open(MODEL).use { it.readBytes() }
    return ByteBuffer.allocateDirect(bytes.size).order(ByteOrder.nativeOrder()).apply {
      put(bytes)
      rewind()
    }
  }

  // Same settings as the server's PoseEngine (server/pose_engine.py), minus
  // segmentation masks: the phone blurs the whole preview instead.
  private fun create(mode: RunningMode): PoseLandmarker {
    val context = NitroModules.applicationContext ?: throw Error("No React context yet")
    val base = BaseOptions.builder().setModelAssetBuffer(modelBuffer()).build()
    val options =
      PoseLandmarker.PoseLandmarkerOptions.builder()
        .setBaseOptions(base)
        .setRunningMode(mode)
        .setNumPoses(1)
        .setMinPoseDetectionConfidence(0.5f)
        .setMinPosePresenceConfidence(0.5f)
        .setMinTrackingConfidence(0.5f)
        .setOutputSegmentationMasks(false)
        .build()
    return PoseLandmarker.createFromOptions(context, options)
  }

  private fun toPoseResult(result: PoseLandmarkerResult, width: Double, height: Double, ms: Double): PoseResult? {
    val pose = result.landmarks().firstOrNull() ?: return null
    if (pose.isEmpty()) return null
    val landmarks = DoubleArray(pose.size * 3)
    pose.forEachIndexed { i, lm ->
      landmarks[i * 3] = lm.x().toDouble()
      landmarks[i * 3 + 1] = lm.y().toDouble()
      landmarks[i * 3 + 2] = lm.visibility().orElse(1f).toDouble()
    }
    val worldPose = result.worldLandmarks().firstOrNull() ?: emptyList()
    val world = DoubleArray(worldPose.size * 3)
    worldPose.forEachIndexed { i, lm ->
      world[i * 3] = lm.x().toDouble()
      world[i * 3 + 1] = lm.y().toDouble()
      world[i * 3 + 2] = lm.z().toDouble()
    }
    return PoseResult(landmarks, world, width, height, ms)
  }

  companion object {
    private const val MODEL = "pose_landmarker_lite.task"
  }
}
