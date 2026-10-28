// Run from the repository root: swift scripts/render-dmg-guide.swift
// Uses AppKit only to render an image; does not control or capture the desktop.
import AppKit
let width = 900, height = 700
let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
let context = NSGraphicsContext(bitmapImageRep: bitmap)!
NSGraphicsContext.current = NSGraphicsContext(cgContext: context.cgContext, flipped: true)
let transform = NSAffineTransform()
transform.translateX(by: 0, yBy: CGFloat(height))
transform.scaleX(by: 1, yBy: -1)
transform.concat()
NSColor(calibratedWhite: 0.10, alpha: 1).setFill()
NSBezierPath(rect: NSRect(x: 0, y: 0, width: width, height: height)).fill()
func text(_ value: String, _ x: CGFloat, _ y: CGFloat, _ size: CGFloat, bold: Bool = false, gray: Bool = false) {
    let style = NSMutableParagraphStyle()
    style.lineBreakMode = .byWordWrapping
    (value as NSString).draw(in: NSRect(x: x, y: y, width: 900-x-24, height: 65), withAttributes: [.font: bold ? NSFont.boldSystemFont(ofSize: size) : NSFont.systemFont(ofSize: size), .foregroundColor: gray ? NSColor(calibratedWhite: 0.72, alpha: 1) : NSColor.white, .paragraphStyle: style])
}
func screenshot(_ path: String, _ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat) {
    NSImage(contentsOf: URL(string: path)!)!.draw(in: NSRect(x: x, y: y, width: w, height: h), from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
}
func outline(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat) {
    NSColor.systemOrange.setStroke()
    let p = NSBezierPath(roundedRect: NSRect(x: x, y: y, width: w, height: h), xRadius: 7, yRadius: 7)
    p.lineWidth = 4
    p.stroke()
}
// The upper area is reserved for the real Finder app and Applications icons.
text("→", 434, 39, 38, gray: true)
text("Mac blocked Yinamp?", 30, 142, 30, bold: true)
text("1  Click Done", 30, 226, 21, bold: true)
screenshot("https://cdsassets.apple.com/live/7WUAS350/images/macos/sequoia/macos-sequoia-app-not-opened-could-not-verify-free-from-malware.png", 30, 264, 260, 232.5)
outline(44, 450, 113, 30)
text("2  Open System Settings", 340, 226, 21, bold: true)
text("Privacy & Security → scroll down → Open Anyway", 340, 257, 16, bold: true)
screenshot("https://cdsassets.apple.com/live/7WUAS350/images/macos/sequoia/macos-sequoia-system-settings-privacy-and-security-open-app-anyway.png", 340, 290, 420, 360)
outline(344, 592, 119, 19)
outline(682, 510, 61, 17)
text("“Example App” = Yinamp", 30, 516, 16, gray: true)
text("No Open Anyway? Open Yinamp\nfrom Applications first.", 30, 575, 16, gray: true)
text("3  Click Open and approve.", 30, 665, 19, bold: true)
NSGraphicsContext.restoreGraphicsState()
try bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.9])!.write(to: URL(fileURLWithPath: "build/dmg/background.jpg"))
