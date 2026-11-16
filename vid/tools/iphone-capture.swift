// swift tools/iphone-capture.swift  ->  lets ffmpeg/QuickTime see a USB-connected iPhone screen as a capture device
// (the CoreMediaIO "allow screen capture devices" switch QuickTime flips), then lists avfoundation devices.
import CoreMediaIO
import Foundation
var prop = CMIOObjectPropertyAddress(mSelector: CMIOObjectPropertySelector(kCMIOHardwarePropertyAllowScreenCaptureDevices),
                                     mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeGlobal),
                                     mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementMain))
var allow: UInt32 = 1
CMIOObjectSetPropertyData(CMIOObjectID(kCMIOObjectSystemObject), &prop, 0, nil, UInt32(MemoryLayout<UInt32>.size), &allow)
sleep(2)
let p = Process(); p.executableURL = URL(fileURLWithPath: "/opt/homebrew/bin/ffmpeg")
p.arguments = ["-hide_banner", "-f", "avfoundation", "-list_devices", "true", "-i", ""]
try? p.run(); p.waitUntilExit()
