#import <Cocoa/Cocoa.h>
#include <math.h>

static NSColor *RGB(unsigned value) {
    return [NSColor colorWithSRGBRed:((value >> 16) & 255) / 255.0
                             green:((value >> 8) & 255) / 255.0
                              blue:(value & 255) / 255.0 alpha:1];
}
static void Fill(NSRect rect, unsigned color) { [RGB(color) setFill]; NSRectFill(rect); }
static void Text(NSString *value, NSRect rect, CGFloat size, unsigned color, NSTextAlignment alignment) {
    NSMutableParagraphStyle *style = [NSMutableParagraphStyle new];
    style.alignment = alignment;
    [value drawInRect:rect withAttributes:@{
        NSFontAttributeName:[NSFont fontWithName:@"Menlo" size:size],
        NSForegroundColorAttributeName:RGB(color), NSParagraphStyleAttributeName:style
    }];
}

@interface YinampLoaderView : NSView
@property(copy) NSString *path;
@property(copy) NSDictionary *state;
- (void)refresh:(NSTimer *)timer;
@end
@implementation YinampLoaderView
- (void)refresh:(NSTimer *)timer {
    NSData *data = [NSData dataWithContentsOfFile:self.path];
    NSDictionary *state = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:NULL] : nil;
    if (![state isKindOfClass:NSDictionary.class] || ![state[@"action"] isKindOfClass:NSString.class] || ![state[@"step"] isKindOfClass:NSNumber.class] || ![state[@"percent"] isKindOfClass:NSNumber.class]) return;
    if (![state isEqual:self.state]) {
        self.state = state;
        self.needsDisplay = YES;
        self.accessibilityElement = YES;
        self.accessibilityRole = NSAccessibilityProgressIndicatorRole;
        self.accessibilityLabel = [NSString stringWithFormat:@"%@, %ld of 4",state[@"action"],(long)[state[@"step"] integerValue]];
        self.accessibilityValue = state[@"percent"];
        self.accessibilityValueDescription = [NSString stringWithFormat:@"%.0f percent",[state[@"percent"] doubleValue]];
    }
}
- (void)drawRect:(NSRect)dirtyRect {
    Fill(self.bounds, 0x30313f);
    Fill(NSMakeRect(0,0,360,1),0x7c7e91); Fill(NSMakeRect(0,111,360,1),0x7c7e91);
    Fill(NSMakeRect(0,0,1,112),0x7c7e91); Fill(NSMakeRect(359,0,1,112),0x7c7e91);
    Text(@"YINAMP",NSMakeRect(16,84,70,18),10,0xdddde7,NSTextAlignmentLeft);
    Fill(NSMakeRect(81,94,263,1),0x7c7e91);
    Text(self.state[@"action"] ?: @"Downloading Electron...",NSMakeRect(27,48,265,18),11,0xdddde7,NSTextAlignmentLeft);
    NSInteger step = self.state ? [self.state[@"step"] integerValue] : 1;
    Text([NSString stringWithFormat:@"%ld/4",(long)step],NSMakeRect(295,48,38,18),11,0xdddde7,NSTextAlignmentRight);
    double percent = MIN(100,MAX(0,[self.state[@"percent"] doubleValue]));
    NSInteger filled = (NSInteger)floor(percent * 28 / 100);
    for (NSInteger i=0;i<28;i++) Fill(NSMakeRect(27+i*11,29,9,8),i<filled ? 0xdddde7 : 0x434452);
}
@end

int main(int argc, const char *argv[]) {
    if (argc == 4 && strcmp(argv[1], "--confirm-uninstall") == 0) {
        @autoreleasepool {
            NSApplication *app = NSApplication.sharedApplication;
            [app setActivationPolicy:NSApplicationActivationPolicyAccessory];
            NSAlert *alert = [NSAlert new];
            alert.messageText = [NSString stringWithUTF8String:argv[2]];
            alert.informativeText = [NSString stringWithUTF8String:argv[3]];
            alert.alertStyle = NSAlertStyleWarning;
            NSURL *helperBundle = NSBundle.mainBundle.bundleURL;
            NSString *icon = [[helperBundle URLByDeletingLastPathComponent].path stringByAppendingPathComponent:@"../Resources/icon.icns"];
            NSImage *image = [[NSImage alloc] initWithContentsOfFile:icon];
            if (image) alert.icon = image;
            NSButton *cancel = [alert addButtonWithTitle:@"Cancel"];
            NSButton *uninstall = [alert addButtonWithTitle:@"Uninstall"];
            cancel.keyEquivalent = @"\r";
            uninstall.keyEquivalent = @"";
            alert.window.initialFirstResponder = cancel;
            [alert.window makeFirstResponder:cancel];
            alert.window.defaultButtonCell = cancel.cell;
            id monitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskKeyDown handler:^NSEvent *(NSEvent *event) {
                if (event.keyCode == 53) { [app abortModal]; return nil; }
                return event;
            }];
            [app finishLaunching];
            [app activateIgnoringOtherApps:YES];
            NSModalResponse response = [alert runModal];
            [NSEvent removeMonitor:monitor];
            puts(response == NSAlertSecondButtonReturn ? "uninstall" : "cancel");
        }
        return 0;
    }
    if (argc == 4 && strcmp(argv[1], "--uninstall") == 0) {
        @autoreleasepool {
            [NSApplication.sharedApplication setActivationPolicy:NSApplicationActivationPolicyAccessory];
            for (int i = 2; i < 4; i++) {
                NSURL *url = [NSURL fileURLWithPath:[NSString stringWithUTF8String:argv[i]]];
                if (![NSFileManager.defaultManager fileExistsAtPath:url.path]) continue;
                NSError *error = nil;
                if (![NSFileManager.defaultManager trashItemAtURL:url resultingItemURL:NULL error:&error]) {
                    NSAlert *alert = [NSAlert new];
                    alert.messageText = @"Yinamp could not finish uninstalling";
                    alert.informativeText = [NSString stringWithFormat:@"Could not move %@ to Trash. %@", url.lastPathComponent, error.localizedDescription];
                    [alert runModal];
                    return 1;
                }
            }
        }
        return 0;
    }
    if (argc != 2) return 1;
    @autoreleasepool {
        NSApplication *app = NSApplication.sharedApplication;
        [app setActivationPolicy:NSApplicationActivationPolicyAccessory];
        NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0,0,360,112)
            styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:NO];
        window.title = @"Yinamp";
        window.releasedWhenClosed = NO;
        window.backgroundColor = RGB(0x30313f);
        window.hasShadow = YES;
        window.movableByWindowBackground = YES;
        window.level = NSFloatingWindowLevel;
        YinampLoaderView *view = [[YinampLoaderView alloc] initWithFrame:NSMakeRect(0,0,360,112)];
        view.path = [NSString stringWithUTF8String:argv[1]];
        window.contentView = view;
        [view refresh:nil];
        [NSTimer scheduledTimerWithTimeInterval:0.1 target:view selector:@selector(refresh:) userInfo:nil repeats:YES];
        [window center];
        [window makeKeyAndOrderFront:nil];
        [app activateIgnoringOtherApps:YES];
        [app run];
    }
    return 0;
}
