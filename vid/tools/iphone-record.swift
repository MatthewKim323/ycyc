// swift tools/iphone-record.swift <out.mov> [maxSeconds]
// Records a USB-connected iPhone's screen (the same device QuickTime's "New Movie Recording" offers).
// Stop early by creating the file <out.mov>.stop (e.g. `touch assets/footage/r8.mov.stop`).
import AVFoundation
import CoreMediaIO
import Foundation

let args = CommandLine.arguments
guard args.count >= 2 else { print("usage: iphone-record.swift <out.mov> [maxSeconds]"); exit(1) }
let outURL = URL(fileURLWithPath: args[1])
let maxSeconds = args.count >= 3 ? Double(args[2]) ?? 60 : 60
let stopPath = args[1] + ".stop"
try? FileManager.default.removeItem(atPath: stopPath)
try? FileManager.default.removeItem(at: outURL)

// Let this process see iOS screen capture devices.
var prop = CMIOObjectPropertyAddress(mSelector: CMIOObjectPropertySelector(kCMIOHardwarePropertyAllowScreenCaptureDevices),
                                     mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeGlobal),
                                     mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementMain))
var allow: UInt32 = 1
CMIOObjectSetPropertyData(CMIOObjectID(kCMIOObjectSystemObject), &prop, 0, nil, UInt32(MemoryLayout<UInt32>.size), &allow)

func findPhone() -> AVCaptureDevice? {
    let types: [AVCaptureDevice.DeviceType] = [.external]
    for media in [AVMediaType.muxed, AVMediaType.video] {
        let s = AVCaptureDevice.DiscoverySession(deviceTypes: types, mediaType: media, position: .unspecified)
        if let d = s.devices.first(where: { $0.modelID.lowercased().contains("iphone") || $0.localizedName.lowercased().contains("iphone") && !$0.localizedName.lowercased().contains("camera") }) {
            return d
        }
    }
    return nil
}

var device: AVCaptureDevice?
for _ in 0..<40 {  // the device can take a few seconds to appear after enabling
    device = findPhone()
    if device != nil { break }
    RunLoop.current.run(until: Date().addingTimeInterval(0.25))
}
guard let phone = device else {
    let all = AVCaptureDevice.DiscoverySession(deviceTypes: [.external, .builtInWideAngleCamera], mediaType: nil, position: .unspecified).devices
    print("no iPhone screen device found. devices: \(all.map { "\($0.localizedName) [\($0.modelID)]" })")
    exit(2)
}
print("recording \(phone.localizedName) -> \(outURL.path)")

final class Delegate: NSObject, AVCaptureFileOutputRecordingDelegate {
    var done = false
    func fileOutput(_ output: AVCaptureFileOutput, didFinishRecordingTo url: URL, from connections: [AVCaptureConnection], error: Error?) {
        if let error { print("finished with: \(error.localizedDescription)") }
        print("saved \(url.path)")
        done = true
    }
}

let session = AVCaptureSession()
do {
    let input = try AVCaptureDeviceInput(device: phone)
    guard session.canAddInput(input) else { print("cannot add input"); exit(3) }
    session.addInput(input)
} catch { print("input error: \(error)"); exit(3) }
let output = AVCaptureMovieFileOutput()
guard session.canAddOutput(output) else { print("cannot add output"); exit(3) }
session.addOutput(output)
session.startRunning()
let delegate = Delegate()
output.startRecording(to: outURL, recordingDelegate: delegate)

let start = Date()
while Date().timeIntervalSince(start) < maxSeconds && !FileManager.default.fileExists(atPath: stopPath) {
    RunLoop.current.run(until: Date().addingTimeInterval(0.2))
}
output.stopRecording()
while !delegate.done { RunLoop.current.run(until: Date().addingTimeInterval(0.1)) }
session.stopRunning()
try? FileManager.default.removeItem(atPath: stopPath)
