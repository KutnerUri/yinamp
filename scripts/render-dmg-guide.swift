// Run from the repository root: swift scripts/render-dmg-guide.swift
// Uses AppKit only to render an image; does not control or capture the desktop.
// Keep width/height and the icon centers in sync with the `dmg:` section of electron-builder.yml.
import AppKit
let width = 800, height = 670
// Finder's title bar covers roughly the bottom 28 px of the configured window height,
// so all guide content stays above this line.
let safeBottom: CGFloat = 640
let phi: CGFloat = (1 + sqrt(5)) / 2
// The guide below is two columns (250 + 40 gutter + 360) centered in the window;
// the install panel spans the same width and is 1 : φ³ tall.
let contentWidth: CGFloat = 650, contentLeft = (CGFloat(width) - contentWidth) / 2
let panel = NSRect(x: contentLeft, y: 48, width: contentWidth, height: (contentWidth / pow(phi, 3)).rounded())
// Square icon tiles; outer padding and arrow gap split the leftover width φ : 1.
let tileSize = panel.height - 28, arrowWidth: CGFloat = 165
let spare = (contentWidth - 2 * tileSize - arrowWidth) / 2
let tilePadding = (spare * phi / (1 + phi)).rounded()
// Finder icon centers (electron-builder.yml `contents`): 88 px icon near the tile top, label below.
let iconSize: CGFloat = 88
let appIcon = NSPoint(x: (panel.minX + tilePadding + tileSize / 2).rounded(.down), y: panel.minY + 14 + 8 + iconSize / 2)
let applicationsIcon = NSPoint(x: (panel.maxX - tilePadding - tileSize / 2).rounded(.up), y: appIcon.y)
print("icon centers: \(appIcon.x), \(applicationsIcon.x) at y \(appIcon.y)")

let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
let context = NSGraphicsContext(bitmapImageRep: bitmap)!
NSGraphicsContext.current = NSGraphicsContext(cgContext: context.cgContext, flipped: true)
let transform = NSAffineTransform()
transform.translateX(by: 0, yBy: CGFloat(height))
transform.scaleX(by: 1, yBy: -1)
transform.concat()
// Colors from Yinamp's Classic skin (skins/classic.json).
func hex(_ v: Int) -> NSColor { NSColor(srgbRed: CGFloat(v >> 16 & 255) / 255, green: CGFloat(v >> 8 & 255) / 255, blue: CGFloat(v & 255) / 255, alpha: 1) }
let desktop = hex(0x14151e), shell = hex(0x30313f), edge = hex(0x7c7e91), accent = hex(0xa7ff48), screen = hex(0x080e08), ink = hex(0xdddde7)
let gray = ink.blended(withFraction: 0.3, of: desktop)!
desktop.setFill()
NSBezierPath(rect: NSRect(x: 0, y: 0, width: width, height: height)).fill()

@discardableResult
func text(_ value: String, _ x: CGFloat, _ y: CGFloat, _ size: CGFloat, width w: CGFloat? = nil, bold: Bool = false, color: NSColor = ink, center: Bool = false) -> CGFloat {
    let style = NSMutableParagraphStyle()
    style.lineBreakMode = .byWordWrapping
    style.alignment = center ? .center : .left
    let attributes: [NSAttributedString.Key: Any] = [.font: bold ? NSFont.boldSystemFont(ofSize: size) : NSFont.systemFont(ofSize: size), .foregroundColor: color, .paragraphStyle: style]
    let box = NSRect(x: x, y: y, width: w ?? CGFloat(width) - x - 24, height: 200)
    let bounds = (value as NSString).boundingRect(with: box.size, options: [.usesLineFragmentOrigin], attributes: attributes)
    (value as NSString).draw(in: box, withAttributes: attributes)
    return y + ceil(bounds.height)
}
// Step badge styled like the player's LCD: dark screen, lime monospace digit.
func badge(_ number: String, center c: NSPoint, diameter d: CGFloat = 22) {
    let dot = NSBezierPath(ovalIn: NSRect(x: c.x - d / 2, y: c.y - d / 2, width: d, height: d))
    screen.setFill(); dot.fill()
    let style = NSMutableParagraphStyle(); style.alignment = .center
    let font = NSFont(name: "CourierNewPS-BoldMT", size: d * 0.68) ?? NSFont.monospacedSystemFont(ofSize: d * 0.6, weight: .bold)
    let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: accent, .paragraphStyle: style]
    // Center the digit's cap height, not the line box, which includes space for descenders.
    let top = c.y - (font.ascender - font.capHeight / 2)
    (number as NSString).draw(in: NSRect(x: c.x - d / 2, y: top, width: d, height: font.ascender - font.descender), withAttributes: attributes)
}
// Draws an Apple example screenshot with a thin dark ring and step badge on each callout.
// Callouts are measured on the screenshot drawn `outlineWidth` px wide.
func screenshot(_ url: String, _ x: CGFloat, _ y: CGFloat, width w: CGFloat, callouts: [(NSRect, String)], outlineWidth: CGFloat) -> CGFloat {
    let image = NSImage(contentsOf: URL(string: url)!)!
    let h = image.size.height * w / image.size.width
    image.draw(in: NSRect(x: x, y: y, width: w, height: h), from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
    let k = w / outlineWidth
    for (o, number) in callouts {
        let target = NSRect(x: x + o.minX * k, y: y + o.minY * k, width: o.width * k, height: o.height * k)
        let ring = NSBezierPath(roundedRect: target, xRadius: 6, yRadius: 6)
        screen.setStroke(); ring.lineWidth = 2; ring.stroke()
        badge(number, center: NSPoint(x: target.maxX, y: target.minY), diameter: 18)
    }
    return y + h
}

// Install step: the real Finder icons for Yinamp and Applications sit on this panel.
shell.setFill()
NSBezierPath(roundedRect: panel, xRadius: 14, yRadius: 14).fill()
// Finder draws icon labels black in Light mode and white in Dark mode, and a DMG cannot change that.
// Each icon and its label sit on a mid-tone tile that both label colors are readable on.
for icon in [appIcon, applicationsIcon] {
    edge.setFill()
    NSBezierPath(roundedRect: NSRect(x: icon.x - tileSize / 2, y: panel.minY + 14, width: tileSize, height: tileSize), xRadius: 14, yRadius: 14).fill()
}
text("Drag Yinamp into Applications", panel.minX, 14, 20, width: panel.width, bold: true, center: true)
// Drag arrow in the player's dot-matrix style, drawn straight on the panel.
// The three-dot-thick shaft fades in from the left like a scrolling marquee.
let arrowRows = 7, headLength = 4
// 3-dot shaft : 33-dot length ≈ 1 : φ⁵; band widths are Fibonacci numbers.
let fadeBands: [(width: Int, alpha: CGFloat)] = [(8, 0.09), (8, 0.23), (8, 0.62), (5, 1)]
let shaftLength = fadeBands.reduce(0) { $0 + $1.width }
let columns = shaftLength + headLength, cell = arrowWidth / CGFloat(columns)
let gapCenter = (appIcon.x + applicationsIcon.x) / 2
let glyphOrigin = NSPoint(x: gapCenter - CGFloat(columns) * cell / 2, y: panel.midY - CGFloat(arrowRows) * cell / 2)  // centered on the panel and tiles, not the icons
func arrowCell(_ column: Int, _ row: Int, alpha: CGFloat) {
    accent.withAlphaComponent(alpha).setFill()
    NSBezierPath(rect: NSRect(x: glyphOrigin.x + CGFloat(column) * cell, y: glyphOrigin.y + CGFloat(row) * cell, width: cell - 1, height: cell - 1)).fill()
}
let middle = arrowRows / 2
// The shaft brightens in LCD-like bands; the last, short band leads straight into the head.
let bandOfColumn = fadeBands.flatMap { band in Array(repeating: band.alpha, count: band.width) }
for (column, level) in bandOfColumn.enumerated() {
    for row in (middle - 1)...(middle + 1) { arrowCell(column, row, alpha: level) }
}
for row in 0..<arrowRows {
    for column in 0..<(headLength - abs(row - middle)) { arrowCell(shaftLength + column, row, alpha: 1) }
}

// First-launch Gatekeeper guide.
text("Mac blocked Yinamp on first open?", contentLeft, 216, 19, bold: true)
text("Follow these steps to run Yinamp:", contentLeft, 242, 15, color: gray)

let left = contentLeft, right = contentLeft + 250 + 40, stepTop: CGFloat = 274
func step(_ number: String, _ title: String, _ x: CGFloat) {
    badge(number, center: NSPoint(x: x + 11, y: stepTop + 11))
    text(title, x + 30, stepTop, 17, bold: true)
}
step("1", "Click Done", left)
var y = screenshot("https://cdsassets.apple.com/live/7WUAS350/images/macos/sequoia/macos-sequoia-app-not-opened-could-not-verify-free-from-malware.png", left, stepTop + 32, width: 250, callouts: [(NSRect(x: 14, y: 186, width: 113, height: 30), "1")], outlineWidth: 260)
y = text("“Example App” = Yinamp", left, y + 16, 14, width: 250, color: gray)
text("No Open Anyway button? Open Yinamp from Applications once, then try again.", left, y + 10, 14, width: 250, color: gray)

// Steps 2 and 3 both happen in System Settings, so they share a column.
step("2", "Privacy & Security", right)
step("3", "Open Anyway", right + 212)
let sub = text("In System Settings, scroll down, then confirm with Open.", right, stepTop + 26, 13, width: 430, color: gray)
let bottom = screenshot("https://cdsassets.apple.com/live/7WUAS350/images/macos/sequoia/macos-sequoia-system-settings-privacy-and-security-open-app-anyway.png", right, sub + 8, width: 360, callouts: [(NSRect(x: 4, y: 302, width: 119, height: 19), "2"), (NSRect(x: 342, y: 220, width: 61, height: 17), "3")], outlineWidth: 420)
precondition(bottom <= safeBottom, "guide overflows the visible window: \(bottom) > \(safeBottom)")

NSGraphicsContext.restoreGraphicsState()
try bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.9])!.write(to: URL(fileURLWithPath: "build/dmg/background.jpg"))
