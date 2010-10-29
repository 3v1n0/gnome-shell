/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

imports.gi.versions.Clutter = '1.0';
imports.gi.versions.Gio = '2.0';
imports.gi.versions.Gdk = '3.0';
imports.gi.versions.GdkPixbuf = '2.0';
imports.gi.versions.Gtk = '3.0';

const Clutter = imports.gi.Clutter;
const DBus = imports.dbus;
const Gdk = imports.gi.Gdk;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const GConf = imports.gi.GConf;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;
const St = imports.gi.St;

const Chrome = imports.ui.chrome;
const Environment = imports.ui.environment;
const ExtensionSystem = imports.ui.extensionSystem;
const MessageTray = imports.ui.messageTray;
const Overview = imports.ui.overview;
const Panel = imports.ui.panel;
const PlaceDisplay = imports.ui.placeDisplay;
const RunDialog = imports.ui.runDialog;
const LookingGlass = imports.ui.lookingGlass;
const NotificationDaemon = imports.ui.notificationDaemon;
const WindowAttentionHandler = imports.ui.windowAttentionHandler;
const Scripting = imports.ui.scripting;
const ShellDBus = imports.ui.shellDBus;
const TelepathyClient = imports.ui.telepathyClient;
const WindowManager = imports.ui.windowManager;
const Magnifier = imports.ui.magnifier;
const StatusIconDispatcher = imports.ui.statusIconDispatcher;

const DEFAULT_BACKGROUND_COLOR = new Clutter.Color();
DEFAULT_BACKGROUND_COLOR.from_pixel(0x2266bbff);

let chrome = null;
let panel = null;
let placesManager = null;
let overview = null;
let runDialog = null;
let lookingGlass = null;
let wm = null;
let messageTray = null;
let notificationDaemon = null;
let windowAttentionHandler = null;
let telepathyClient = null;
let recorder = null;
let shellDBusService = null;
let modalCount = 0;
let modalActorFocusStack = [];
let uiGroup = null;
let magnifier = null;
let statusIconDispatcher = null;
let _errorLogStack = [];
let _startDate;

let background = null;

function start() {
    // Add a binding for 'global' in the global JS namespace; (gjs
    // keeps the web browser convention of having that namespace be
    // called 'window'.)
    window.global = Shell.Global.get();

    // Now monkey patch utility functions into the global proxy;
    // This is easier and faster than indirecting down into global
    // if we want to call back up into JS.
    global.logError = _logError;
    global.log = _logDebug;

    Gio.DesktopAppInfo.set_desktop_env('GNOME');

    global.grab_dbus_service();
    shellDBusService = new ShellDBus.GnomeShell();
    // Force a connection now; dbus.js will do this internally
    // if we use its name acquisition stuff but we aren't right
    // now; to do so we'd need to convert from its async calls
    // back into sync ones.
    DBus.session.flush();

    Environment.init();

    // Ensure ShellWindowTracker and ShellAppUsage are initialized; this will
    // also initialize ShellAppSystem first.  ShellAppSystem
    // needs to load all the .desktop files, and ShellWindowTracker
    // will use those to associate with windows.  Right now
    // the Monitor doesn't listen for installed app changes
    // and recalculate application associations, so to avoid
    // races for now we initialize it here.  It's better to
    // be predictable anyways.
    Shell.WindowTracker.get_default();
    Shell.AppUsage.get_default();

    // The background color really only matters if there is no desktop
    // window (say, nautilus) running. We set it mostly so things look good
    // when we are running inside Xephyr.
    global.stage.color = DEFAULT_BACKGROUND_COLOR;

    let themeContext = St.ThemeContext.get_for_stage (global.stage);
    let stylesheetPath = global.datadir + '/theme/gnome-shell.css';
    let theme = new St.Theme ({ application_stylesheet: stylesheetPath });
    themeContext.set_theme (theme);

    let shellwm = global.window_manager;
    shellwm.takeover_keybinding('panel_main_menu');
    shellwm.connect('keybinding::panel_main_menu', function () {
        overview.toggle();
    });
    shellwm.takeover_keybinding('panel_run_dialog');
    shellwm.connect('keybinding::panel_run_dialog', function () {
       getRunDialog().open();
    });

    // Set up stage hierarchy to group all UI actors under one container.
    uiGroup = new Clutter.Group();
    global.window_group.reparent(uiGroup);
    global.overlay_group.reparent(uiGroup);
    global.stage.add_actor(uiGroup);

    placesManager = new PlaceDisplay.PlacesManager();
    overview = new Overview.Overview();
    chrome = new Chrome.Chrome();
    magnifier = new Magnifier.Magnifier();
    statusIconDispatcher = new StatusIconDispatcher.StatusIconDispatcher();
    panel = new Panel.Panel();
    wm = new WindowManager.WindowManager();
    messageTray = new MessageTray.MessageTray();
    notificationDaemon = new NotificationDaemon.NotificationDaemon();
    windowAttentionHandler = new WindowAttentionHandler.WindowAttentionHandler();
    telepathyClient = new TelepathyClient.Client();

    _startDate = new Date();

    let recorderSettings = new Gio.Settings({ schema: 'org.gnome.shell.recorder' });

    global.screen.connect('toggle-recording', function() {
        if (recorder == null) {
            recorder = new Shell.Recorder({ stage: global.stage });
        }

        if (recorder.is_recording()) {
            recorder.pause();
        } else {
            // read the parameters from GSettings always in case they have changed
            recorder.set_framerate(recorderSettings.get_int('framerate'));
            recorder.set_filename('shell-%d%u-%c.' + recorderSettings.get_string('file-extension'));
            let pipeline = recorderSettings.get_string('pipeline');

            if (!pipeline.match(/^\s*$/))
                recorder.set_pipeline(pipeline);
            else
                recorder.set_pipeline(null);

            recorder.record();
        }
    });

    background = global.create_root_pixmap_actor();
    global.stage.add_actor(background);
    background.lower_bottom();

    global.gdk_screen.connect('monitors-changed', _relayout);

    ExtensionSystem.init();
    ExtensionSystem.loadExtensions();

    panel.startupAnimation();

    let display = global.screen.get_display();
    display.connect('overlay-key', Lang.bind(overview, overview.toggle));

    global.stage.connect('captured-event', _globalKeyPressHandler);

    // Perform initial relayout here
    _relayout();

    _log('info', 'loaded at ' + _startDate);
    log('GNOME Shell started at ' + _startDate);

    Mainloop.idle_add(_removeUnusedWorkspaces);

    let perfModuleName = GLib.getenv("SHELL_PERF_MODULE");
    if (perfModuleName) {
        let perfOutput = GLib.getenv("SHELL_PERF_OUTPUT");
        let module = eval('imports.perf.' + perfModuleName + ';');
        Scripting.runPerfScript(module, perfOutput);
    }
}

/**
 * _log:
 * @category: string message type ('info', 'error')
 * @msg: A message string
 * ...: Any further arguments are converted into JSON notation,
 *      and appended to the log message, separated by spaces.
 *
 * Log a message into the LookingGlass error
 * stream.  This is primarily intended for use by the
 * extension system as well as debugging.
 */
function _log(category, msg) {
    let text = msg;
    if (arguments.length > 2) {
        text += ': ';
        for (let i = 2; i < arguments.length; i++) {
            text += JSON.stringify(arguments[i]);
            if (i < arguments.length - 1)
                text += ' ';
        }
    }
    _errorLogStack.push({timestamp: new Date().getTime(),
                         category: category,
                         message: text });
}

function _logError(msg) {
    return _log('error', msg);
}

function _logDebug(msg) {
    return _log('debug', msg);
}

// Used by the error display in lookingGlass.js
function _getAndClearErrorStack() {
    let errors = _errorLogStack;
    _errorLogStack = [];
    return errors;
}

function _relayout() {
    let primary = global.get_primary_monitor();
    panel.actor.set_position(primary.x, primary.y);
    panel.actor.set_size(primary.width, Panel.PANEL_HEIGHT);
    overview.relayout();

    background.set_size(global.screen_width, global.screen_height);

    // To avoid updating the position and size of the workspaces
    // in the overview, we just hide the overview. The positions
    // will be updated when it is next shown. We do the same for
    // the calendar popdown.
    overview.hide();
    panel.hideCalendar();
}

// metacity-clutter currently uses the same prefs as plain metacity,
// which probably means we'll be starting out with multiple workspaces;
// remove any unused ones. (We do this from an idle handler, because
// global.get_window_actors() still returns NULL at the point when start()
// is called.)
function _removeUnusedWorkspaces() {

    let windows = global.get_window_actors();
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
    if (event.type() != Clutter.EventType.KEY_RELEASE)
        return false;

    let symbol = event.get_key_symbol();
    let keyCode = event.get_key_code();
    let modifierState = Shell.get_event_state(event);
    // Check the overview key first, this isn't a Meta.KeyBindingAction yet
    if (symbol == Clutter.Super_L || symbol == Clutter.Super_R) {
        // The super key is the default for triggering the overview, and should
        // get us out of the overview when we are already in it.
        if (overview.visible)
            overview.hide();

        return true;
    }

    // Whitelist some of the Metacity actions
    let display = global.screen.get_display();
    let activeWorkspaceIndex = global.screen.get_active_workspace_index();

    // This relies on the fact that Clutter.ModifierType is the same as Gdk.ModifierType
    let action = display.get_keybinding_action(keyCode, modifierState);
    switch (action) {
        case Meta.KeyBindingAction.COMMAND_SCREENSHOT:
            let gconf = GConf.Client.get_default();
            let command = gconf.get_string('/apps/metacity/keybinding_commands/command_screenshot');
            if (command != null && command != '') {
                let [ok, len, args] = GLib.shell_parse_argv(command);
                let p = new Shell.Process({'args' : args});
                p.run();
            }
            return true;
        case Meta.KeyBindingAction.WORKSPACE_LEFT:
            wm.actionMoveWorkspaceLeft();
            return true;
        case Meta.KeyBindingAction.WORKSPACE_RIGHT:
            wm.actionMoveWorkspaceRight();
            return true;
        case Meta.KeyBindingAction.PANEL_RUN_DIALOG:
        case Meta.KeyBindingAction.COMMAND_2:
            getRunDialog().open();
            return true;
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
        if (!global.begin_modal(global.get_current_time())) {
            log('pushModal: invocation of begin_modal failed');
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

    global.stage.set_key_focus(null);
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

    global.end_modal(global.get_current_time());
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

/**
 * activateWindow:
 * @window: the Meta.Window to activate
 * @time: (optional) current event time
 * @workspaceNum: (optional) window's workspace number
 *
 * Activates @window, switching to its workspace first if necessary,
 * and switching out of the overview if it's currently active
 */
function activateWindow(window, time, workspaceNum) {
    let activeWorkspaceNum = global.screen.get_active_workspace_index();
    let windowWorkspaceNum = (workspaceNum !== undefined) ? workspaceNum : window.get_workspace().index();

    if (!time)
        time = global.get_current_time();

    if (windowWorkspaceNum != activeWorkspaceNum) {
        let workspace = global.screen.get_workspace_by_index(windowWorkspaceNum);
        workspace.activate_with_focus(window, time);
    } else {
        window.activate(time);
    }

    overview.hide();
}

// TODO - replace this timeout with some system to guess when the user might
// be e.g. just reading the screen and not likely to interact.
const DEFERRED_TIMEOUT_SECONDS = 20;
var _deferredWorkData = {};
// Work scheduled for some point in the future
var _deferredWorkQueue = [];
// Work we need to process before the next redraw
var _beforeRedrawQueue = [];
// Counter to assign work ids
var _deferredWorkSequence = 0;
var _deferredTimeoutId = 0;

function _runDeferredWork(workId) {
    if (!_deferredWorkData[workId])
        return;
    let index = _deferredWorkQueue.indexOf(workId);
    if (index < 0)
        return;

    _deferredWorkQueue.splice(index, 1);
    _deferredWorkData[workId].callback();
    if (_deferredWorkQueue.length == 0 && _deferredTimeoutId > 0) {
        Mainloop.source_remove(_deferredTimeoutId);
        _deferredTimeoutId = 0;
    }
}

function _runAllDeferredWork() {
    while (_deferredWorkQueue.length > 0)
        _runDeferredWork(_deferredWorkQueue[0]);
}

function _runBeforeRedrawQueue() {
    for (let i = 0; i < _beforeRedrawQueue.length; i++) {
        let workId = _beforeRedrawQueue[i];
        _runDeferredWork(workId);
    }
    _beforeRedrawQueue = [];
}

function _queueBeforeRedraw(workId) {
    _beforeRedrawQueue.push(workId);
    if (_beforeRedrawQueue.length == 1) {
        Meta.later_add(Meta.LaterType.BEFORE_REDRAW, function () {
            _runBeforeRedrawQueue();
            return false;
        });
    }
}

/**
 * initializeDeferredWork:
 * @actor: A #ClutterActor
 * @callback: Function to invoke to perform work
 *
 * This function sets up a callback to be invoked when either the
 * given actor is mapped, or after some period of time when the machine
 * is idle.  This is useful if your actor isn't always visible on the
 * screen (for example, all actors in the overview), and you don't want
 * to consume resources updating if the actor isn't actually going to be
 * displaying to the user.
 *
 * Note that queueDeferredWork is called by default immediately on
 * initialization as well, under the assumption that new actors
 * will need it.
 *
 * Returns: A string work identifer
 */
function initializeDeferredWork(actor, callback, props) {
    // Turn into a string so we can use as an object property
    let workId = '' + (++_deferredWorkSequence);
    _deferredWorkData[workId] = { 'actor': actor,
                                  'callback': callback };
    actor.connect('notify::mapped', function () {
        if (!(actor.mapped && _deferredWorkQueue.indexOf(workId) >= 0))
            return;
        _queueBeforeRedraw(workId);
    });
    actor.connect('destroy', function() {
        let index = _deferredWorkQueue.indexOf(workId);
        if (index >= 0)
            _deferredWorkQueue.splice(index, 1);
        delete _deferredWorkData[workId];
    });
    queueDeferredWork(workId);
    return workId;
}

/**
 * queueDeferredWork:
 * @workId: work identifier
 *
 * Ensure that the work identified by @workId will be
 * run on map or timeout.  You should call this function
 * for example when data being displayed by the actor has
 * changed.
 */
function queueDeferredWork(workId) {
    let data = _deferredWorkData[workId];
    if (!data) {
        global.logError('invalid work id ', workId);
        return;
    }
    if (_deferredWorkQueue.indexOf(workId) < 0)
        _deferredWorkQueue.push(workId);
    if (data.actor.mapped) {
        _queueBeforeRedraw(workId);
        return;
    } else if (_deferredTimeoutId == 0) {
        _deferredTimeoutId = Mainloop.timeout_add_seconds(DEFERRED_TIMEOUT_SECONDS, function () {
            _runAllDeferredWork();
            _deferredTimeoutId = 0;
            return false;
        });
    }
}
