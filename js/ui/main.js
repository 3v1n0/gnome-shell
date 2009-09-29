/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

const Clutter = imports.gi.Clutter;
const DBus = imports.dbus;
const Gdk = imports.gi.Gdk;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;
const Signals = imports.signals;
const St = imports.gi.St;

const Chrome = imports.ui.chrome;
const Overview = imports.ui.overview;
const Panel = imports.ui.panel;
const RunDialog = imports.ui.runDialog;
const LookingGlass = imports.ui.lookingGlass;
const ShellDBus = imports.ui.shellDBus;
const Sidebar = imports.ui.sidebar;
const Tweener = imports.ui.tweener;
const WindowManager = imports.ui.windowManager;

const DEFAULT_BACKGROUND_COLOR = new Clutter.Color();
DEFAULT_BACKGROUND_COLOR.from_pixel(0x2266bbff);

let chrome = null;
let panel = null;
let sidebar = null;
let overview = null;
let runDialog = null;
let lookingGlass = null;
let wm = null;
let recorder = null;
let shellDBusService = null;
let modalCount = 0;
let modalActorFocusStack = [];

// "monkey patch" in some varargs ClutterContainer methods; we need
// to do this per-container class since there is no representation
// of interfaces in Javascript
function _patchContainerClass(containerClass) {
    // This one is a straightforward mapping of the C method
    containerClass.prototype.child_set = function(actor, props) {
        let meta = this.get_child_meta(actor);
        for (prop in props)
            meta[prop] = props[prop];
    };

    // clutter_container_add() actually is a an add-many-actors
    // method. We conveniently, but somewhat dubiously, take the
    // this opportunity to make it do something more useful.
    containerClass.prototype.add = function(actor, props) {
        this.add_actor(actor);
        if (props)
            this.child_set(actor, props);
    };
}
_patchContainerClass(St.BoxLayout);

function start() {
    // Add a binding for "global" in the global JS namespace; (gjs
    // keeps the web browser convention of having that namespace be
    // called "window".)
    window.global = Shell.Global.get();

    Gio.DesktopAppInfo.set_desktop_env("GNOME");

    global.grab_dbus_service();
    shellDBusService = new ShellDBus.GnomeShell();
    // Force a connection now; dbus.js will do this internally
    // if we use its name acquisition stuff but we aren't right
    // now; to do so we'd need to convert from its async calls
    // back into sync ones.
    DBus.session.flush();

    Tweener.init();

    // Ensure ShellAppMonitor is initialized; this will
    // also initialize ShellAppSystem first.  ShellAppSystem
    // needs to load all the .desktop files, and ShellAppMonitor
    // will use those to associate with windows.  Right now
    // the Monitor doesn't listen for installed app changes
    // and recalculate application associations, so to avoid
    // races for now we initialize it here.  It's better to
    // be predictable anyways.
    Shell.AppMonitor.get_default();

    // The background color really only matters if there is no desktop
    // window (say, nautilus) running. We set it mostly so things look good
    // when we are running inside Xephyr.
    global.stage.color = DEFAULT_BACKGROUND_COLOR;

    // Mutter currently hardcodes putting "Yessir. The compositor is running""
    // in the Overview. Clear that out.
    let children = global.overlay_group.get_children();
    for (let i = 0; i < children.length; i++)
        children[i].destroy();

    let style = St.Style.get_default();
    let stylesheetPath = global.datadir + "/gnome-shell.css";
    style.load_from_file(stylesheetPath);

    global.connect('panel-run-dialog', function(panel) {
        // Make sure not more than one run dialog is shown.
        getRunDialog().open();
    });
    let shellwm = global.window_manager;
    shellwm.takeover_keybinding("panel_main_menu");
    shellwm.connect("keybinding::panel_main_menu", function () {
        overview.toggle();
    });
    shellwm.takeover_keybinding("panel_run_dialog");
    shellwm.connect("keybinding::panel_run_dialog", function () {
       getRunDialog().open();
    });

    overview = new Overview.Overview();
    chrome = new Chrome.Chrome();
    panel = new Panel.Panel();
    sidebar = new Sidebar.Sidebar();
    wm = new WindowManager.WindowManager();

    global.screen.connect('toggle-recording', function() {
        if (recorder == null) {
            recorder = new Shell.Recorder({ stage: global.stage });
        }

        if (recorder.is_recording()) {
            recorder.pause();
        } else {
            recorder.record();
        }
    });

    _relayout();

    panel.startupAnimation();

    let display = global.screen.get_display();
    display.connect('overlay-key', Lang.bind(overview, overview.toggle));
    global.connect('panel-main-menu', Lang.bind(overview, overview.toggle));

    global.stage.connect('captured-event', _globalKeyPressHandler);

    Mainloop.idle_add(_removeUnusedWorkspaces);
}

function _relayout() {
    panel.actor.set_size(global.screen_width, Panel.PANEL_HEIGHT);
    overview.relayout();
}

// metacity-clutter currently uses the same prefs as plain metacity,
// which probably means we'll be starting out with multiple workspaces;
// remove any unused ones. (We do this from an idle handler, because
// global.get_windows() still returns NULL at the point when start()
// is called.)
function _removeUnusedWorkspaces() {

    let windows = global.get_windows();
    let maxWorkspace = 0;
    for (let i = 0; i < windows.length; i++) {
        let win = windows[i];

        if (!win.get_meta_window().is_on_all_workspaces() &&
            win.get_workspace() > maxWorkspace) {
            maxWorkspace = win.get_workspace();
        }
    }
    let screen = global.screen;
    if (screen.n_workspaces > maxWorkspace) {
        for (let w = screen.n_workspaces - 1; w > maxWorkspace; w--) {
            let workspace = screen.get_workspace_by_index(w);
            screen.remove_workspace(workspace, 0);
        }
    }

    return false;
}

// This function encapsulates hacks to make certain global keybindings
// work even when we are in one of our modes where global keybindings
// are disabled with a global grab. (When there is a global grab, then
// all key events will be delivered to the stage, so ::captured-event
// on the stage can be used for global keybindings.)
//
// We expect to need to conditionally enable just a few keybindings
// depending on circumstance; the main hackiness here is that we are
// assuming that keybindings have their default values; really we
// should be asking Mutter to resolve the key into an action and then
// base our handling based on the action.
function _globalKeyPressHandler(actor, event) {
    if (modalCount == 0)
        return false;

    let type = event.type();

    if (type == Clutter.EventType.KEY_PRESS) {
        let symbol = event.get_key_symbol();
        if (symbol == Clutter.Print) {
            // We want to be able to take screenshots of the shell at all times
            let gconf = Shell.GConf.get_default();
            let command = gconf.get_string("/apps/metacity/keybinding_commands/command_screenshot");
            if (command != null && command != "") {
                let [ok, len, args] = GLib.shell_parse_argv(command);
                let p = new Shell.Process({'args' : args});
                p.run();
            }

            return true;
        }
    } else if (type == Clutter.EventType.KEY_RELEASE) {
        let symbol = event.get_key_symbol();
        if (symbol == Clutter.Super_L || symbol == Clutter.Super_R) {
            // The super key is the default for triggering the overview, and should
            // get us out of the overview when we are already in it.
            if (overview.visible)
                overview.hide();

            return true;
        } else if (symbol == Clutter.F2 && (event.get_state() & Clutter.ModifierType.MOD1_MASK)) {
            getRunDialog().open();
        }
    }

    return false;
}

function _findModal(actor) {
    for (let i = 0; i < modalActorFocusStack.length; i++) {
        let [stackActor, stackFocus] = modalActorFocusStack[i];
        if (stackActor == actor) {
            return i;
        }
    }
    return -1;
}

/**
 * pushModal:
 * @actor: #ClutterActor which will be given keyboard focus
 *
 * Ensure we are in a mode where all keyboard and mouse input goes to
 * the stage.  Multiple calls to this function act in a stacking fashion;
 * the effect will be undone when an equal number of popModal() invocations
 * have been made.
 *
 * Next, record the current Clutter keyboard focus on a stack.  If the modal stack
 * returns to this actor, reset the focus to the actor which was focused
 * at the time pushModal() was invoked.
 *
 * Returns: true iff we successfully acquired a grab or already had one
 */
function pushModal(actor) {
    if (modalCount == 0) {
        if (!global.begin_modal(currentTime())) {
            log("pushModal: invocation of begin_modal failed");
            return false;
        }
    }

    global.set_stage_input_mode(Shell.StageInputMode.FULLSCREEN);

    modalCount += 1;
    actor.connect('destroy', function() {
        let index = _findModal(actor);
        if (index >= 0)
            modalActorFocusStack.splice(index, 1);
    });
    let curFocus = global.stage.get_key_focus();
    if (curFocus != null) {
        curFocus.connect('destroy', function() {
            let index = _findModal(actor);
            if (index >= 0)
                modalActorFocusStack[index][1] = null;
        });
    }
    modalActorFocusStack.push([actor, curFocus]);

    return true;
}

/**
 * popModal:
 * @actor: #ClutterActor passed to original invocation of pushModal().
 *
 * Reverse the effect of pushModal().  If this invocation is undoing
 * the topmost invocation, then the focus will be restored to the
 * previous focus at the time when pushModal() was invoked.
 */
function popModal(actor) {
    modalCount -= 1;
    let focusIndex = _findModal(actor);
    if (focusIndex >= 0) {
        if (focusIndex == modalActorFocusStack.length - 1) {
            let [stackActor, stackFocus] = modalActorFocusStack[focusIndex];
            global.stage.set_key_focus(stackFocus);
        } else {
            // Remove from the middle, shift the focus chain up
            for (let i = focusIndex; i < modalActorFocusStack.length - 1; i++) {
                modalActorFocusStack[i + 1][1] = modalActorFocusStack[i][1];
            }
        }
        modalActorFocusStack.splice(focusIndex, 1);
    }
    if (modalCount > 0)
        return;

    global.end_modal(currentTime());
    global.set_stage_input_mode(Shell.StageInputMode.NORMAL);
}

function createLookingGlass() {
    if (lookingGlass == null) {
        lookingGlass = new LookingGlass.LookingGlass();
        lookingGlass.slaveTo(panel.actor);
    }
    return lookingGlass;
}

function getRunDialog() {
    if (runDialog == null) {
        runDialog = new RunDialog.RunDialog();
    }
    return runDialog;
}

function createAppLaunchContext() {
    let context = new Gdk.AppLaunchContext();
    context.set_timestamp(currentTime());

    // Make sure that the app is opened on the current workspace even if
    // the user switches before it starts
    context.set_desktop(global.screen.get_active_workspace_index());

    return context;
}

/**
 * currentTime:
 *
 * Gets the current X server time from the current Clutter, Gdk, or X
 * event. If called from outside an event handler, this may return
 * %Clutter.CURRENT_TIME (aka 0), or it may return a slightly
 * out-of-date timestamp.
 */
function currentTime() {
    // meta_display_get_current_time() will return the correct time
    // when handling an X or Gdk event, but will return CurrentTime
    // from some Clutter event callbacks.
    //
    // clutter_get_current_event_time() will return the correct time
    // from a Clutter event callback, but may return an out-of-date
    // timestamp if called at other times.
    //
    // So we try meta_display_get_current_time() first, since we
    // can recognize a "wrong" answer from that, and then fall back
    // to clutter_get_current_event_time().

    let time = global.screen.get_display().get_current_time();
    if (time != Clutter.CURRENT_TIME)
        return time;

    return Clutter.get_current_event_time();
}

/**
 * activateWindow:
 * @window: the Meta.Window to activate
 * @time: (optional) current event time
 *
 * Activates @window, switching to its workspace first if necessary
 */
function activateWindow(window, time) {
    let activeWorkspaceNum = global.screen.get_active_workspace_index();
    let windowWorkspaceNum = window.get_workspace().index();

    if (!time)
        time = currentTime();

    if (windowWorkspaceNum != activeWorkspaceNum) {
        let workspace = global.screen.get_workspace_by_index(windowWorkspaceNum);
        workspace.activate_with_focus(window, time);
    } else {
        window.activate(time);
    }
}
