#!/usr/bin/env python3
# 龙虾脑 · 鼠标控制工具（零依赖，调用系统 CoreGraphics via ctypes）
# 依赖：macOS 自带 python3 + ctypes（无需安装任何包）
# 用法：
#   python3 mousectl.py get                打印当前光标位置 "x y"
#   python3 mousectl.py screensize         打印主屏尺寸 "w h"
#   python3 mousectl.py move <x> <y>      移动光标到绝对坐标
#   python3 mousectl.py click              在当前位置左键单击
#   python3 mousectl.py click <x> <y>     移动后左键单击
import sys, time, ctypes

cg = ctypes.CDLL('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics')

class CGPoint(ctypes.Structure):
    _fields_ = [("x", ctypes.c_double), ("y", ctypes.c_double)]

class CGSize(ctypes.Structure):
    _fields_ = [("width", ctypes.c_double), ("height", ctypes.c_double)]

class CGRect(ctypes.Structure):
    _fields_ = [("origin", CGPoint), ("size", CGSize)]

cg.CGEventCreate.restype = ctypes.c_void_p
cg.CGEventCreate.argtypes = [ctypes.c_void_p]
cg.CGEventGetLocation.restype = CGPoint
cg.CGEventGetLocation.argtypes = [ctypes.c_void_p]
cg.CGWarpMouseCursorPosition.argtypes = [CGPoint]
cg.CGEventCreateMouseEvent.restype = ctypes.c_void_p
cg.CGEventCreateMouseEvent.argtypes = [ctypes.c_void_p, ctypes.c_int, CGPoint, ctypes.c_int]
cg.CGEventPost.argtypes = [ctypes.c_int, ctypes.c_void_p]
cg.CGMainDisplayID.restype = ctypes.c_uint
cg.CGDisplayBounds.restype = CGRect
cg.CGDisplayBounds.argtypes = [ctypes.c_uint]

kCGEventLeftMouseDown = 1
kCGEventLeftMouseUp = 2
kCGHIDEventTap = 0
kCGMouseButtonLeft = 0

def get_pos():
    ev = cg.CGEventCreate(None)
    p = cg.CGEventGetLocation(ev)
    return int(p.x), int(p.y)

def move(x, y):
    cg.CGWarpMouseCursorPosition(CGPoint(x, y))

def click(x=None, y=None):
    if x is None or y is None:
        x, y = get_pos()
    p = CGPoint(x, y)
    down = cg.CGEventCreateMouseEvent(None, kCGEventLeftMouseDown, p, kCGMouseButtonLeft)
    cg.CGEventPost(kCGHIDEventTap, down)
    time.sleep(0.008)
    up = cg.CGEventCreateMouseEvent(None, kCGEventLeftMouseUp, p, kCGMouseButtonLeft)
    cg.CGEventPost(kCGHIDEventTap, up)

def screensize():
    r = cg.CGDisplayBounds(cg.CGMainDisplayID())
    return int(r.size.width), int(r.size.height)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.stderr.write("usage: mousectl.py <get|screensize|move x y|click [x y]>\n")
        sys.exit(1)
    cmd = sys.argv[1]
    if cmd == "get":
        print("%d %d" % get_pos())
    elif cmd == "screensize":
        print("%d %d" % screensize())
    elif cmd == "move":
        move(float(sys.argv[2]), float(sys.argv[3]))
    elif cmd == "click":
        if len(sys.argv) >= 4:
            click(float(sys.argv[2]), float(sys.argv[3]))
        else:
            click()
    else:
        sys.stderr.write("unknown command: %s\n" % cmd)
        sys.exit(1)
