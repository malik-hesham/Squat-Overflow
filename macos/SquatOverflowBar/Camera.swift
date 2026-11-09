import AVFoundation
import CoreImage
import SquatCore

/// The webcam: frames for the pose server (480 px wide JPEG, quality 0.7, like
/// extension/lib/pose-client.js) and the mirrored preview.
final class Camera: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate, @unchecked Sendable {
    static let captureWidth: CGFloat = 480
    static let jpegQuality: CGFloat = 0.7

    private let session = AVCaptureSession()
    private let queue = DispatchQueue(label: "squatoverflow.camera")
    private let lock = NSLock()
    private var frame: CIImage?
    let context = CIContext(options: [.cacheIntermediates: false])

    static func requestAccess() async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: return true
        case .notDetermined: return await AVCaptureDevice.requestAccess(for: .video)
        default: return false
        }
    }

    /// Starts the front camera; false when there's none or it can't be opened.
    func start() -> Bool {
        let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front)
            ?? AVCaptureDevice.default(for: .video)
        guard let device, let input = try? AVCaptureDeviceInput(device: device) else { return false }
        session.beginConfiguration()
        session.sessionPreset = session.canSetSessionPreset(.hd1280x720) ? .hd1280x720 : .high
        guard session.canAddInput(input) else { session.commitConfiguration(); return false }
        session.addInput(input)
        let output = AVCaptureVideoDataOutput()
        output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
        output.alwaysDiscardsLateVideoFrames = true
        output.setSampleBufferDelegate(self, queue: queue)
        guard session.canAddOutput(output) else { session.commitConfiguration(); return false }
        session.addOutput(output)
        session.commitConfiguration()
        queue.async { self.session.startRunning() }
        return true
    }

    func stop() {
        queue.async { self.session.stopRunning() }
        lock.withLock { frame = nil }
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard let buffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let image = CIImage(cvPixelBuffer: buffer)
        lock.withLock { frame = image }
    }

    /// The newest frame, not mirrored.
    var latest: CIImage? { lock.withLock { frame } }

    /// The frame as the server takes it: 480 px wide JPEG.
    func jpeg(_ image: CIImage) -> Data? {
        let scale = Self.captureWidth / image.extent.width
        let small = image.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        return context.jpegRepresentation(of: small, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!,
                                          options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: Self.jpegQuality])
    }
}

/// Draws the preview the way extension/lib/pose-client.js does: mirrored; with privacy on the
/// person is blurred (the server's mask marks the person; without a fresh mask the whole frame is
/// blurred); then the skeleton, green, or amber while there's a form issue.
final class PreviewRenderer: @unchecked Sendable {
    static let privacyDownscale: CGFloat = 24
    static let minVisibility = 0.5

    private let context: CIContext
    private var maskSource: String?
    private var maskImage: CIImage?

    init(context: CIContext) { self.context = context }

    func render(_ frame: CIImage, privacy: Bool, mask: String?, landmarks: [[Double]]?, issues: Bool,
                connections: [[Int]]) -> CGImage? {
        let w = frame.extent.width, h = frame.extent.height
        let mirror = CGAffineTransform(translationX: w, y: 0).scaledBy(x: -1, y: 1)
        let sharp = frame.transformed(by: CGAffineTransform(translationX: -frame.extent.minX, y: -frame.extent.minY)).transformed(by: mirror)
        var out = sharp
        if privacy {
            let k = Self.privacyDownscale
            let blurred = sharp.transformed(by: CGAffineTransform(scaleX: 1 / k, y: 1 / k)).samplingLinear()
                .transformed(by: CGAffineTransform(scaleX: k, y: k)).cropped(to: sharp.extent)
            if let m = decodeMask(mask) {
                let fitted = m.transformed(by: CGAffineTransform(scaleX: w / m.extent.width, y: h / m.extent.height)).transformed(by: mirror)
                out = blurred.applyingFilter("CIBlendWithAlphaMask", parameters: [kCIInputBackgroundImageKey: sharp, kCIInputMaskImageKey: fitted])
            } else {
                out = blurred
            }
        }
        guard let base = context.createCGImage(out, from: sharp.extent) else { return nil }
        guard let landmarks, !landmarks.isEmpty else { return base }
        return drawSkeleton(on: base, landmarks: landmarks, issues: issues, connections: connections)
    }

    private func decodeMask(_ dataURL: String?) -> CIImage? {
        guard let dataURL else { return nil }
        if dataURL == maskSource { return maskImage }
        maskSource = dataURL
        let b64 = dataURL.split(separator: ",", maxSplits: 1).last.map(String.init) ?? ""
        maskImage = Data(base64Encoded: b64).flatMap { CIImage(data: $0) }
        return maskImage
    }

    private func drawSkeleton(on image: CGImage, landmarks: [[Double]], issues: Bool, connections: [[Int]]) -> CGImage? {
        let w = CGFloat(image.width), h = CGFloat(image.height)
        guard let ctx = CGContext(data: nil, width: image.width, height: image.height, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        else { return image }
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
        let color = issues ? CGColor(srgbRed: 1, green: 0.71, blue: 0.28, alpha: 1) : CGColor(srgbRed: 0.24, green: 0.86, blue: 0.59, alpha: 1)
        // Landmarks are normalised to the un-mirrored frame, y down; the preview is mirrored, y up.
        func point(_ i: Int) -> CGPoint? {
            guard landmarks.indices.contains(i), landmarks[i].count >= 3, landmarks[i][2] >= Self.minVisibility else { return nil }
            return CGPoint(x: (1 - landmarks[i][0]) * w, y: (1 - landmarks[i][1]) * h)
        }
        ctx.setLineWidth(max(3, w / 180))
        ctx.setLineCap(.round)
        ctx.setStrokeColor(color)
        for pair in connections where pair.count == 2 {
            guard let a = point(pair[0]), let b = point(pair[1]) else { continue }
            ctx.move(to: a)
            ctx.addLine(to: b)
            ctx.strokePath()
        }
        let r = max(4, w / 140)
        ctx.setLineWidth(2)
        for i in 11..<landmarks.count {
            guard let p = point(i) else { continue }
            let dot = CGRect(x: p.x - r, y: p.y - r, width: 2 * r, height: 2 * r)
            ctx.setFillColor(.white)
            ctx.fillEllipse(in: dot)
            ctx.strokeEllipse(in: dot)
        }
        return ctx.makeImage() ?? image
    }
}
