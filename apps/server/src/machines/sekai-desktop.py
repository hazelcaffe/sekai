#!/usr/bin/env python3
"""sekai-desktop: lets a Sekai bot see and use its Linux desktop.

Runs on the bot's computer as the bot's user (Sekai calls it over SSH). Output is JSON, except
`screenshot`, which writes a PNG to stdout.

  info                        screen size, pointer, active window
  screenshot [MAX_WIDTH]      PNG of the whole screen, scaled down to MAX_WIDTH (default 1280)
  tree [APP] [--all]          accessibility tree: interactive elements with ids and boxes
  act ID [ACTION]             do an element's action (click, press, toggle...) by its tree id
  focus-element ID            give an element keyboard focus
  focused                     the element with keyboard focus (role, name, whether it's a password field)
  click X Y [BUTTON] [COUNT]  BUTTON: left, middle, right
  move X Y
  drag X1 Y1 X2 Y2
  scroll X Y up|down|left|right [AMOUNT]
  type                        types text read from stdin
  key COMBO...                e.g. ctrl+l, Return, alt+F4
  windows                     open windows
  activate WINDOW_ID          raise and focus a window
  open COMMAND...             start an app in the background
  clipboard get | set         (set reads stdin)
  browser [PORT] [PROFILE]    makes sure Chrome is running with remote debugging on PORT (9222), with its
                              profile in PROFILE (a folder in your home; default ~/.config/sekai-chrome)
  version                     this helper's version
  wait-idle [SECONDS]         waits until the screen stops changing (max SECONDS)
"""

import json
import os
import shutil
import subprocess
import sys
import time
import warnings

warnings.filterwarnings("ignore")

def session_display():
    """This account's display, as Sekai's setup wrote it (/etc/sekai/desktop/USER.env); :0 otherwise."""
    try:
        import pwd
        with open("/etc/sekai/desktop/%s.env" % pwd.getpwuid(os.getuid()).pw_name) as f:
            for line in f:
                key, _, value = line.strip().partition("=")
                if key == "DISPLAY" and value:
                    return value
    except Exception:  # noqa: BLE001
        pass
    return ":0"


os.environ.setdefault("DISPLAY", session_display())
os.environ.setdefault("XAUTHORITY", os.path.expanduser("~/.Xauthority"))
os.environ.setdefault("DBUS_SESSION_BUS_ADDRESS", "unix:path=/run/user/%d/bus" % os.getuid())

INTERACTIVE = {
    "push button", "toggle button", "check box", "radio button", "menu item", "check menu item",
    "radio menu item", "combo box", "list item", "page tab", "text", "entry", "password text",
    "spin button", "slider", "link", "tree item", "table cell", "icon", "menu", "tool bar item",
    "split button", "toggle", "editbar", "terminal", "document web", "heading", "image",
    "scroll bar", "notification", "alert", "dialog", "status bar", "label", "paragraph",
    "section", "table row", "column header", "row header", "canvas",
}
CONTAINERS = {"filler", "panel", "scroll pane", "viewport", "layered pane", "unknown", "redundant object"}


def out(obj):
    sys.stdout.write(json.dumps(obj))
    sys.stdout.write("\n")


def fail(msg, code=1):
    out({"error": msg})
    sys.exit(code)


PACKAGES = {"xdotool": "xdotool", "import": "imagemagick", "wmctrl": "wmctrl", "xclip": "xclip"}


def run(args, input_bytes=None, check=True):
    try:
        p = subprocess.run(args, input=input_bytes, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except FileNotFoundError:
        fail("%s isn't installed (package: %s)" % (args[0], PACKAGES.get(args[0], args[0])))
    if check and p.returncode != 0:
        fail("%s: %s" % (" ".join(args[:2]), p.stderr.decode(errors="replace").strip()[-400:]))
    return p.stdout


def wake():
    """Turns the screen back on if something blanked it (the bot would otherwise see black)."""
    if not shutil.which("xset"):
        return
    subprocess.run(["xset", "dpms", "force", "on"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run(["xset", "s", "reset"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def screen_size():
    o = run(["xdotool", "getdisplaygeometry"]).decode().split()
    return int(o[0]), int(o[1])


def active_window():
    p = subprocess.run(["xdotool", "getactivewindow", "getwindowname"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    return p.stdout.decode(errors="replace").strip() or None


def windows():
    if not shutil.which("wmctrl"):
        return []
    lines = run(["wmctrl", "-lpGx"], check=False).decode(errors="replace").splitlines()
    result = []
    for line in lines:
        parts = line.split(None, 9)
        if len(parts) < 9:
            continue
        wid, desk, pid, x, y, w, h, wmclass = parts[:8]
        title = parts[9] if len(parts) > 9 else ""
        if desk == "-1":
            continue  # panels and the desktop itself
        result.append({"id": wid, "app": wmclass.split(".")[-1], "title": title,
                       "x": int(x), "y": int(y), "width": int(w), "height": int(h)})
    return result


def cmd_info():
    w, h = screen_size()
    loc = run(["xdotool", "getmouselocation", "--shell"]).decode().splitlines()
    mouse = dict(l.split("=", 1) for l in loc if "=" in l)
    out({"width": w, "height": h, "pointer": [int(mouse.get("X", 0)), int(mouse.get("Y", 0))],
         "activeWindow": active_window(), "windows": windows()})


def cmd_screenshot(max_width="1280"):
    w, h = screen_size()
    mw = int(max_width)
    args = ["import", "-silent", "-window", "root"]
    if w > mw:
        args += ["-resize", "%dx" % mw]
    args += ["png:-"]
    data = run(args)
    sys.stdout.buffer.write(data)


# ---------------------------------------------------------------- accessibility (AT-SPI)

def atspi():
    try:
        import gi
        gi.require_version("Atspi", "2.0")
        from gi.repository import Atspi
        return Atspi
    except Exception as e:  # noqa: BLE001
        fail("accessibility isn't available (%s). Use screenshots and coordinates instead." % e)


def node_info(Atspi, acc):
    try:
        role = acc.get_role_name()
        name = (acc.get_name() or "").strip()
        states = acc.get_state_set()
        if not states.contains(Atspi.StateType.SHOWING) and role not in ("application", "frame"):
            return None, False
        box = None
        try:
            comp = acc.get_component_iface()
            if comp:
                e = comp.get_extents(Atspi.CoordType.SCREEN)
                if e.width > 0 and e.height > 0:
                    box = [e.x, e.y, e.width, e.height]
        except Exception:  # noqa: BLE001
            pass
        flags = []
        for label, st in (("focused", Atspi.StateType.FOCUSED), ("checked", Atspi.StateType.CHECKED),
                          ("selected", Atspi.StateType.SELECTED), ("expanded", Atspi.StateType.EXPANDED),
                          ("disabled", None)):
            if label == "disabled":
                if not states.contains(Atspi.StateType.ENABLED) and role in INTERACTIVE:
                    flags.append("disabled")
            elif states.contains(st):
                flags.append(label)
        value = None
        try:
            # The interface getters return the object itself; the class functions take it as the first argument.
            if acc.get_text_iface() and role in ("text", "entry", "password text", "terminal", "spin button", "combo box"):
                n = Atspi.Text.get_character_count(acc)
                value = "•••" if role == "password text" else Atspi.Text.get_text(acc, 0, min(n, 300))
        except Exception:  # noqa: BLE001
            pass
        actions = []
        try:
            if acc.get_action_iface():
                actions = [Atspi.Action.get_action_name(acc, i) for i in range(Atspi.Action.get_n_actions(acc))]
        except Exception:  # noqa: BLE001
            pass
        return {"role": role, "name": name, "box": box, "states": flags, "value": value, "actions": actions}, True
    except Exception:  # noqa: BLE001
        return None, False


def walk(Atspi, acc, path, depth, items, show_all, limit):
    if len(items) >= limit or depth > 40:
        return
    info, showing = node_info(Atspi, acc)
    if info is None:
        return
    keep = show_all or info["role"] in INTERACTIVE or (info["name"] and info["role"] not in CONTAINERS)
    if keep and info["box"] and info["role"] not in ("application",):
        info["id"] = path
        items.append(info)
    try:
        n = acc.get_child_count()
    except Exception:  # noqa: BLE001
        n = 0
    for i in range(min(n, 500)):
        try:
            child = acc.get_child_at_index(i)
        except Exception:  # noqa: BLE001
            continue
        if child is not None:
            walk(Atspi, child, "%s.%d" % (path, i), depth + 1, items, show_all, limit)


def find(Atspi, path):
    desktop = Atspi.get_desktop(0)
    acc = desktop
    for part in path.split(".")[1:]:
        acc = acc.get_child_at_index(int(part))
        if acc is None:
            fail("element %s is gone; take a new tree" % path)
    return acc


def cmd_tree(*args):
    Atspi = atspi()
    show_all = "--all" in args
    app_filter = next((a for a in args if not a.startswith("--")), None)
    desktop = Atspi.get_desktop(0)
    apps = []
    items = []
    active = active_window()
    for i in range(desktop.get_child_count()):
        app = desktop.get_child_at_index(i)
        if app is None:
            continue
        name = app.get_name() or ""
        apps.append(name)
        if app_filter and app_filter.lower() not in name.lower():
            continue
        walk(Atspi, app, "0.%d" % i, 0, items, show_all, 600)
    out({"activeWindow": active, "apps": apps, "elements": items, "truncated": len(items) >= 600})


def cmd_focused():
    """The element with keyboard focus in the active window: its role and name (a password field's text is never
    read). Searches only what's showing, with a time limit, since a web page's tree can be large."""
    Atspi = atspi()
    deadline = time.time() + 4
    seen = [0]

    def deepest(acc, depth):
        if acc is None or depth > 60 or seen[0] > 5000 or time.time() > deadline:
            return None
        seen[0] += 1
        try:
            states = acc.get_state_set()
            if depth > 0 and not states.contains(Atspi.StateType.SHOWING):
                return None
            n = acc.get_child_count()
        except Exception:  # noqa: BLE001
            return None
        for i in range(min(n, 300)):
            try:
                found = deepest(acc.get_child_at_index(i), depth + 1)
            except Exception:  # noqa: BLE001
                continue
            if found is not None:
                return found
        return acc if states.contains(Atspi.StateType.FOCUSED) else None

    desktop = Atspi.get_desktop(0)
    for i in range(desktop.get_child_count()):
        app = desktop.get_child_at_index(i)
        if app is None:
            continue
        for j in range(app.get_child_count()):
            win = app.get_child_at_index(j)
            try:
                if win is None or not win.get_state_set().contains(Atspi.StateType.ACTIVE):
                    continue
            except Exception:  # noqa: BLE001
                continue
            found = deepest(win, 0)
            if found is not None:
                role = found.get_role_name()
                out({"role": role, "name": (found.get_name() or "").strip()[:200], "password": role == "password text",
                     "app": app.get_name() or None})
                return
    out({"role": None, "name": None, "password": False, "app": None})


def cmd_act(path, action=None):
    Atspi = atspi()
    acc = find(Atspi, path)
    if acc.get_action_iface() is None or Atspi.Action.get_n_actions(acc) == 0:
        fail("that element has no actions; click its box instead")
    names = [Atspi.Action.get_action_name(acc, i) for i in range(Atspi.Action.get_n_actions(acc))]
    idx = 0
    if action:
        if action not in names:
            fail("actions available: %s" % ", ".join(names))
        idx = names.index(action)
    Atspi.Action.do_action(acc, idx)
    out({"ok": True, "did": names[idx]})


def cmd_focus_element(path):
    Atspi = atspi()
    acc = find(Atspi, path)
    comp = acc.get_component_iface()
    if comp is None or not comp.grab_focus():
        fail("couldn't focus that element")
    out({"ok": True})


# ---------------------------------------------------------------- input

BUTTONS = {"left": "1", "middle": "2", "right": "3"}


def cmd_click(x, y, button="left", count="1"):
    run(["xdotool", "mousemove", "--sync", str(int(float(x))), str(int(float(y))),
         "click", "--repeat", str(int(count)), "--delay", "80", BUTTONS.get(button, "1")])
    out({"ok": True})


def cmd_move(x, y):
    run(["xdotool", "mousemove", "--sync", str(int(float(x))), str(int(float(y)))])
    out({"ok": True})


def cmd_drag(x1, y1, x2, y2):
    run(["xdotool", "mousemove", "--sync", x1, y1, "mousedown", "1"])
    time.sleep(0.1)
    # Move in steps so apps see a real drag.
    for i in range(1, 11):
        x = int(float(x1) + (float(x2) - float(x1)) * i / 10)
        y = int(float(y1) + (float(y2) - float(y1)) * i / 10)
        run(["xdotool", "mousemove", str(x), str(y)])
        time.sleep(0.02)
    run(["xdotool", "mouseup", "1"])
    out({"ok": True})


def cmd_scroll(x, y, direction, amount="3"):
    button = {"up": "4", "down": "5", "left": "6", "right": "7"}.get(direction)
    if not button:
        fail("direction: up, down, left or right")
    run(["xdotool", "mousemove", "--sync", x, y, "click", "--repeat", str(int(amount)), "--delay", "40", button])
    out({"ok": True})


def cmd_type():
    text = sys.stdin.buffer.read()
    run(["xdotool", "type", "--delay", "12", "--file", "-"], input_bytes=text)
    out({"ok": True, "chars": len(text.decode(errors="replace"))})


def cmd_key(*combos):
    if not combos:
        fail("key needs at least one combo, e.g. ctrl+l")
    run(["xdotool", "key", "--delay", "60"] + list(combos))
    out({"ok": True})


def cmd_windows():
    out({"activeWindow": active_window(), "windows": windows()})


def cmd_activate(wid):
    run(["wmctrl", "-ia", wid])
    out({"ok": True})


def cmd_open(*command):
    if not command:
        fail("open needs a command")
    subprocess.Popen(list(command), stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                     stderr=subprocess.DEVNULL, start_new_session=True)
    time.sleep(1.5)
    out({"ok": True, "activeWindow": active_window()})


def cmd_clipboard(op):
    if op == "get":
        out({"text": run(["xclip", "-selection", "clipboard", "-o"], check=False).decode(errors="replace")})
    elif op == "set":
        run(["xclip", "-selection", "clipboard", "-i"], input_bytes=sys.stdin.buffer.read())
        out({"ok": True})
    else:
        fail("clipboard get | set")


def chrome_binary():
    for b in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser"):
        if shutil.which(b):
            return b
    return None


def chromes_on(port):
    """Chrome processes started with this debugging port: (pid, uid, profile folder)."""
    found = []
    for pid in os.listdir("/proc"):
        if not pid.isdigit():
            continue
        try:
            with open("/proc/%s/cmdline" % pid, "rb") as f:
                args = f.read().decode(errors="replace").split("\0")
            uid = os.stat("/proc/%s" % pid).st_uid
        except Exception:  # noqa: BLE001
            continue
        if "--remote-debugging-port=%s" % port not in args or any(a.startswith("--type=") for a in args):
            continue
        folder = next((a.split("=", 1)[1] for a in args if a.startswith("--user-data-dir=")), "")
        found.append((int(pid), uid, os.path.realpath(folder) if folder else ""))
    return found


def cmd_browser(port="9222", profile=None):
    import urllib.request
    if not str(port).isdigit():
        fail("the port must be a number")
    home = os.path.realpath(os.path.expanduser("~"))
    folder = os.path.realpath(os.path.expanduser(profile or "~/.config/sekai-chrome"))
    if not folder.startswith(home + os.sep):
        fail("the profile must be a folder in your home")
    url = "http://127.0.0.1:%s/json/version" % port
    # Another profile's Chrome on this port (a shared browser that moved, say): never hand that one out. A leftover
    # of a shared browser of this account's is stopped; anything else is an error.
    shared = os.path.join(home, ".config", "sekai-shared") + os.sep
    for pid, uid, other in chromes_on(port):
        if other == folder:
            continue
        if uid == os.getuid() and other.startswith(shared):
            try:
                os.kill(pid, 15)
            except Exception:  # noqa: BLE001
                pass
            for _ in range(40):
                if not os.path.exists("/proc/%d" % pid):
                    break
                time.sleep(0.1)
        else:
            fail("port %s is taken by another Chrome" % port)
    try:
        urllib.request.urlopen(url, timeout=1).read()
        out({"ok": True, "port": int(port), "started": False})
        return
    except Exception:  # noqa: BLE001
        pass
    binary = chrome_binary()
    if not binary:
        fail("Chrome isn't installed")
    os.makedirs(folder, exist_ok=True)
    subprocess.Popen([binary, "--remote-debugging-port=%s" % port, "--remote-debugging-address=127.0.0.1",
                      "--user-data-dir=%s" % folder, "--no-first-run", "--no-default-browser-check",
                      "--password-store=basic",
                      "--disable-features=Translate,PrivacySandboxSettings4,PasswordLeakDetection,AutofillServerCommunication",
                      "--force-renderer-accessibility",
                      "--start-maximized", "about:blank"],
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     # Chrome joins the accessibility layer (AT-SPI) only when told assistive technology is on.
                     env=dict(os.environ, ACCESSIBILITY_ENABLED="1"), start_new_session=True)
    for _ in range(60):
        time.sleep(0.25)
        try:
            urllib.request.urlopen(url, timeout=1).read()
            out({"ok": True, "port": int(port), "started": True})
            return
        except Exception:  # noqa: BLE001
            continue
    fail("Chrome didn't open its debugging port")


def cmd_wait_idle(seconds="3"):
    import hashlib
    deadline = time.time() + float(seconds)
    last = None
    while time.time() < deadline:
        digest = hashlib.md5(run(["import", "-silent", "-window", "root", "-resize", "320x", "gray:-"])).hexdigest()
        if digest == last:
            out({"idle": True})
            return
        last = digest
        time.sleep(0.35)
    out({"idle": False})


VERSION = 3


def cmd_version():
    out({"version": VERSION})


COMMANDS = {
    "version": cmd_version, "info": cmd_info, "screenshot": cmd_screenshot, "tree": cmd_tree, "act": cmd_act,
    "focus-element": cmd_focus_element, "focused": cmd_focused, "click": cmd_click, "move": cmd_move, "drag": cmd_drag,
    "scroll": cmd_scroll, "type": cmd_type, "key": cmd_key, "windows": cmd_windows,
    "activate": cmd_activate, "open": cmd_open, "clipboard": cmd_clipboard, "browser": cmd_browser,
    "wait-idle": cmd_wait_idle,
}

if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        sys.stderr.write(__doc__)
        sys.exit(2)
    if sys.argv[1] not in ("clipboard", "windows", "version"):
        wake()
    try:
        COMMANDS[sys.argv[1]](*sys.argv[2:])
    except TypeError as e:
        fail("bad arguments: %s" % e)
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        fail("%s: %s" % (type(e).__name__, e))
