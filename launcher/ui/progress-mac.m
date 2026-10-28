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

@interface YinampLoaderWindow : NSWindow
@end
@implementation YinampLoaderWindow
- (BOOL)canBecomeKeyWindow { return YES; }
@end

@interface YinampLoaderView : NSView
@property(copy) NSString *path;
@property(copy) NSDictionary *state;
@property BOOL animationMode;
@property double started;
@property double clock;
@property double cancelStarted;
@property BOOL cancelling;
@property(strong) NSMutableArray<NSNumber *> *sparkStarts;
- (void)refresh:(NSTimer *)timer;
@end
@implementation YinampLoaderView
- (BOOL)acceptsFirstResponder { return YES; }
- (void)keyDown:(NSEvent *)event {
    if (event.keyCode == 53) [self cancel:nil];
    else [super keyDown:event];
}
- (void)cancel:(id)sender {
    if (self.cancelling) return;
    self.cancelling = YES;
    self.cancelStarted = self.clock;
    if (!self.animationMode) [@"cancel" writeToFile:[self.path stringByAppendingString:@".cancel"] atomically:YES encoding:NSUTF8StringEncoding error:NULL];
    if ([sender isKindOfClass:NSButton.class]) [sender setEnabled:NO];
}
- (void)refresh:(NSTimer *)timer {
    self.clock = NSProcessInfo.processInfo.systemUptime - self.started;
    NSDictionary *state;
    if (self.animationMode) {
        double t = fmod(self.clock, 20.0);
        if (self.cancelling && self.clock-self.cancelStarted >= 2.0) { [NSApp terminate:nil]; return; }
        NSInteger step = t < 7 ? 1 : t < 7.35 ? 2 : t < 11.35 ? 3 : t < 15 ? 4 : 5;
        double percent = step == 1 ? 100*t/7 : step == 3 ? 100*(t-7.35)/4 : 0;
        if (t >= 17 || self.cancelling) {
            step = 6;
            percent = 100*MAX(0,1-(self.cancelling ? self.clock-self.cancelStarted : t-17)/2.0);
        }
        state = @{ @"step":@(step), @"percent":@(percent), @"action":@"Preview" };
    } else {
        NSData *data = [NSData dataWithContentsOfFile:self.path];
        state = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:NULL] : nil;
    }
    if ([state isKindOfClass:NSDictionary.class] && [state[@"step"] isKindOfClass:NSNumber.class] && [state[@"percent"] isKindOfClass:NSNumber.class]) {
        NSInteger previous = [self.state[@"step"] integerValue];
        NSInteger step = MAX(1, MIN(6, [state[@"step"] integerValue]));
        if (!self.sparkStarts) self.sparkStarts = [NSMutableArray new];
        if (step != previous) {
            // Preserve every crossed stage, including transitions between polls.
            NSInteger count = step > previous ? step-previous : 1;
            for (NSInteger i=0; i<count; i++) [self.sparkStarts addObject:@(self.clock+i*0.12)];
        }
        self.state = state;
        NSIndexSet *expired = [self.sparkStarts indexesOfObjectsPassingTest:^BOOL(NSNumber *start, NSUInteger idx, BOOL *stop) {
            return self.clock-start.doubleValue > 1.2;
        }];
        [self.sparkStarts removeObjectsAtIndexes:expired];
        NSArray *actions = @[@"Downloading player components", @"Verifying download", @"Unpacking player components", @"Preparing Yinamp", @"Opening Yinamp", @"Cleaning up temporary files"];
        self.accessibilityElement = YES;
        self.accessibilityRole = NSAccessibilityProgressIndicatorRole;
        self.accessibilityLabel = step == 6 ? actions[5] : [NSString stringWithFormat:@"%@, stage %ld of 5", actions[step-1], (long)step];
        BOOL measured = step == 1 || step == 3 || step == 6;
        self.accessibilityValue = measured ? state[@"percent"] : nil;
        self.accessibilityValueDescription = measured ? [NSString stringWithFormat:@"%.0f percent", [state[@"percent"] doubleValue]] : @"In progress";
    }
    self.needsDisplay = YES;
}
- (void)drawRect:(NSRect)dirtyRect {
    NSInteger step = MAX(1, MIN(6, [self.state[@"step"] integerValue]));
    BOOL reduced = NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion;
    double clock = reduced ? 0 : self.clock;
    Fill(self.bounds, 0x30313f);
    Fill(NSMakeRect(0,0,400,1),0x191a23); Fill(NSMakeRect(0,179,400,1),0x7c7e91);
    Fill(NSMakeRect(0,0,1,180),0x7c7e91); Fill(NSMakeRect(399,0,1,180),0x191a23);
    Text(@"YINAMP",NSMakeRect(18,151,70,18),10,0xdddde7,NSTextAlignmentLeft);
    Fill(NSMakeRect(85,161,297,1),0x7c7e91);
    Fill(NSMakeRect(85,158,297,1),0x434452);
    if (!reduced) for (NSNumber *start in self.sparkStarts) {
        double age = self.clock-start.doubleValue;
        if (age >= 0 && age < 1.2) Fill(NSMakeRect(85 + age*295/1.2,158,2,4),0xdddde7);
    }
    Text(step == 6 ? @"CLEANING UP" : step == 5 ? @"BACK TO THE DESKTOP." : @"SETTING UP YINAMP",NSMakeRect(24,118,352,20),12,0xdddde7,NSTextAlignmentLeft);
    NSArray *actions = @[@"Downloading player components", @"Verifying download", @"Unpacking player components", @"Preparing your player", @"Opening Yinamp", @"Cleaning up temporary files"];
    Text(actions[step-1],NSMakeRect(24,95,305,18),10,0xaaaabb,NSTextAlignmentLeft);
    BOOL measured = step == 1 || step == 3 || step == 6;
    double percent = MIN(100,MAX(0,[self.state[@"percent"] doubleValue]));
    if (measured) Text([NSString stringWithFormat:@"%.0f%%",percent],NSMakeRect(330,95,46,18),10,0xdddde7,NSTextAlignmentRight);
    // Recessed segmented display. Only measured work fills the meter.
    Fill(NSMakeRect(23,70,354,20),0x191a23);
    Fill(NSMakeRect(24,71,352,18),0x252631);
    NSInteger filled = (NSInteger)floor(percent*32/100);
    NSInteger sweep = (NSInteger)(clock*14) % 38 - 3;
    for (NSInteger i=0;i<32;i++) {
        BOOL lit = measured ? i < filled : (reduced ? i%4 == 0 : labs(i-sweep)<3);
        unsigned color = lit ? 0xbcbcca : 0x434452;
        if (lit && !reduced && i == sweep) color = 0xeeeef5;
        Fill(NSMakeRect(26+i*(339.0/31),75,9,10),color);
        if (lit) Fill(NSMakeRect(26+i*(339.0/31),84,9,1),0xdddde7);
    }
    NSArray *labels = @[@"GET", @"CHECK", @"UNPACK", @"PREPARE", @"OPEN"];
    for (NSInteger i=0;i<5;i++) {
        CGFloat x = 24+i*73;
        unsigned color = i+1 <= step ? 0xdddde7 : 0x676879;
        Fill(NSMakeRect(x,51.5,5,5),color);
        if (i+1 == step) Fill(NSMakeRect(x+1,52.5,3,3),0x30313f);
        Text(labels[i],NSMakeRect(x+9,42,63,16),8,color,NSTextAlignmentLeft);
    }
    Text(self.animationMode ? @"ANIMATION PREVIEW" : @"A little setup. Then it’s your music.",NSMakeRect(24,13,270,18),9,0x9293a5,NSTextAlignmentLeft);
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
            NSMutableArray *trashed = [NSMutableArray new];
            for (int i = 2; i < 4; i++) {
                NSURL *url = [NSURL fileURLWithPath:[NSString stringWithUTF8String:argv[i]]];
                if (![NSFileManager.defaultManager fileExistsAtPath:url.path]) continue;
                NSError *error = nil;
                NSURL *destination = nil;
                if (![NSFileManager.defaultManager trashItemAtURL:url resultingItemURL:&destination error:&error]) {
                    NSAlert *alert = [NSAlert new];
                    alert.messageText = @"Yinamp could not finish uninstalling";
                    alert.informativeText = [NSString stringWithFormat:@"Could not move %@ to Trash. %@", url.lastPathComponent, error.localizedDescription];
                    [NSApplication.sharedApplication finishLaunching];
                    [NSApplication.sharedApplication activateIgnoringOtherApps:YES];
                    [alert runModal];
                    return 1;
                }
                [trashed addObject:@{@"source":url.path, @"destination":destination.path}];
            }
            NSData *report = [NSJSONSerialization dataWithJSONObject:@{@"event":@"yinamp-uninstalled", @"trashed":trashed} options:0 error:NULL];
            puts([[NSString alloc] initWithData:report encoding:NSUTF8StringEncoding].UTF8String);
        }
        return 0;
    }
#ifdef YINAMP_LOADER_PREVIEW
    if (argc == 4 && strcmp(argv[1], "--render-preview") == 0) {
        @autoreleasepool {
            [NSApplication sharedApplication];
            YinampLoaderView *view = [[YinampLoaderView alloc] initWithFrame:NSMakeRect(0,0,400,180)];
            view.animationMode = YES;
            view.started = NSProcessInfo.processInfo.systemUptime - atof(argv[3]);
            [view refresh:nil];
            NSBitmapImageRep *bitmap = [view bitmapImageRepForCachingDisplayInRect:view.bounds];
            [view cacheDisplayInRect:view.bounds toBitmapImageRep:bitmap];
            NSData *png = [bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
            return [png writeToFile:[NSString stringWithUTF8String:argv[2]] atomically:YES] ? 0 : 1;
        }
    }
#endif
    if (argc != 2) return 1;
    @autoreleasepool {
        NSApplication *app = NSApplication.sharedApplication;
        [app setActivationPolicy:NSApplicationActivationPolicyAccessory];
        NSWindow *window = [[YinampLoaderWindow alloc] initWithContentRect:NSMakeRect(0,0,400,180)
            styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:NO];
        window.title = @"Yinamp";
        window.releasedWhenClosed = NO;
        window.backgroundColor = RGB(0x30313f);
        window.hasShadow = YES;
        window.movableByWindowBackground = YES;
        window.level = NSFloatingWindowLevel;
        YinampLoaderView *view = [[YinampLoaderView alloc] initWithFrame:NSMakeRect(0,0,400,180)];
        view.path = [NSString stringWithUTF8String:argv[1]];
        view.animationMode = [view.path isEqualToString:@"--animation-mode"];
        view.started = NSProcessInfo.processInfo.systemUptime;
        window.contentView = view;
        NSButton *cancel = [NSButton buttonWithTitle:view.animationMode ? @"Close" : @"Cancel" target:view action:@selector(cancel:)];
        cancel.frame = NSMakeRect(319,10,60,23);
        cancel.bezelStyle = NSBezelStyleSmallSquare;
        cancel.font = [NSFont fontWithName:@"Menlo" size:10];
        cancel.keyEquivalent = @"\e";
        [view addSubview:cancel];
        [view refresh:nil];
        [NSTimer scheduledTimerWithTimeInterval:0.1 target:view selector:@selector(refresh:) userInfo:nil repeats:YES];
        [window makeFirstResponder:view];
        [window center];
        [window makeKeyAndOrderFront:nil];
        [app activateIgnoringOtherApps:YES];
        [app run];
    }
    return 0;
}
