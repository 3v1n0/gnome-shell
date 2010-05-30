/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Pango = imports.gi.Pango;
const St = imports.gi.St;
const Shell = imports.gi.Shell;
const Signals = imports.signals;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Gettext = imports.gettext.domain('gnome-shell');
const _ = Gettext.gettext;

const ExtensionSystem = imports.ui.extensionSystem;
const Link = imports.ui.link;
const Tweener = imports.ui.tweener;
const Main = imports.ui.main;

/* Imports...feel free to add here as needed */
var commandHeader = 'const Clutter = imports.gi.Clutter; ' +
                    'const GLib = imports.gi.GLib; ' +
                    'const Gtk = imports.gi.Gtk; ' +
                    'const Mainloop = imports.mainloop; ' +
                    'const Meta = imports.gi.Meta; ' +
                    'const Shell = imports.gi.Shell; ' +
                    'const Main = imports.ui.main; ' +
                    'const Lang = imports.lang; ' +
                    'const Tweener = imports.ui.tweener; ' +
                    /* Utility functions...we should probably be able to use these
                     * in the shell core code too. */
                    'const stage = global.stage; ' +
                    'const color = function(pixel) { let c= new Clutter.Color(); c.from_pixel(pixel); return c; }; ' +
                    /* Special lookingGlass functions */
                       'const it = Main.lookingGlass.getIt(); ' +
                    'const r = Lang.bind(Main.lookingGlass, Main.lookingGlass.getResult); ';

function Notebook() {
    this._init();
}

Notebook.prototype = {
    _init: function() {
        this.actor = new St.BoxLayout({ vertical: true });

        this.tabControls = new St.BoxLayout({ style_class: 'labels' });

        this._selectedIndex = -1;
        this._tabs = [];
    },

    appendPage: function(name, child) {
        let labelBox = new St.BoxLayout({ style_class: 'notebook-tab',
                                          reactive: true,
                                          track_hover: true });
        let label = new St.Button({ label: name });
        label.connect('clicked', Lang.bind(this, function () {
            this.selectChild(child);
            return true;
        }));
        labelBox.add(label, { expand: true });
        this.tabControls.add(labelBox);

        let scrollview = new St.ScrollView({ x_fill: true, y_fill: true });
        scrollview.get_hscroll_bar().hide();
        scrollview.add_actor(child);

        let tabData = { child: child,
                        labelBox: labelBox,
                        label: label,
                        scrollView: scrollview,
                        _scrollToBottom: false };
        this._tabs.push(tabData);
        scrollview.hide();
        this.actor.add(scrollview, { expand: true });

        let vAdjust = scrollview.vscroll.adjustment;
        vAdjust.connect('changed', Lang.bind(this, function () { this._onAdjustScopeChanged(tabData); }));
        vAdjust.connect('notify::value', Lang.bind(this, function() { this._onAdjustValueChanged(tabData); }));

        if (this._selectedIndex == -1)
            this.selectIndex(0);
    },

    _unselect: function() {
        if (this._selectedIndex < 0)
            return;
        let tabData = this._tabs[this._selectedIndex];
        tabData.labelBox.remove_style_pseudo_class('selected');
        tabData.scrollView.hide();
        this._selectedIndex = -1;
    },

    selectIndex: function(index) {
        if (index == this._selectedIndex)
            return;
        this._unselect();
        if (index < 0) {
            this.emit('selection', null);
            return;
        }
        let tabData = this._tabs[index];
        tabData.labelBox.add_style_pseudo_class('selected');
        tabData.scrollView.show();
        this._selectedIndex = index;
        this.emit('selection', tabData.child);
    },

    selectChild: function(child) {
        if (child == null)
            this.selectIndex(-1);
        else {
            for (let i = 0; i < this._tabs.length; i++) {
                let tabData = this._tabs[i];
                if (tabData.child == child) {
                    this.selectIndex(i);
                    return;
                }
            }
        }
    },

    scrollToBottom: function(index) {
        let tabData = this._tabs[index];
        tabData._scrollToBottom = true;

    },

    _onAdjustValueChanged: function (tabData) {
        let vAdjust = tabData.scrollView.vscroll.adjustment;
        if (vAdjust.value < (vAdjust.upper - vAdjust.lower - 0.5))
            tabData._scrolltoBottom = false;
    },

    _onAdjustScopeChanged: function (tabData) {
        if (!tabData._scrollToBottom)
            return;
        let vAdjust = tabData.scrollView.vscroll.adjustment;
        vAdjust.value = vAdjust.upper - vAdjust.page_size;
    }
};
Signals.addSignalMethods(Notebook.prototype);

function objectToString(o) {
    if (typeof(o) == typeof(objectToString)) {
        // special case this since the default is way, way too verbose
        return "<js function>";
    } else {
        return "" + o;
    }
}

function ObjLink(o, title) {
    this._init(o, title);
}

ObjLink.prototype = {
    __proto__: Link.Link,

    _init: function(o, title) {
        let text;
        if (title)
            text = title;
        else
            text = objectToString(o);
        text = GLib.markup_escape_text(text, -1);
        this._obj = o;
        Link.Link.prototype._init.call(this, { label: text });
        this.actor.get_child().single_line_mode = true;
        this.actor.connect('clicked', Lang.bind(this, this._onClicked));
    },

    _onClicked: function (link) {
        Main.lookingGlass.inspectObject(this._obj, this.actor);
    }
};

function Result(command, o, index) {
    this._init(command, o, index);
}

Result.prototype = {
    _init : function(command, o, index) {
        this.index = index;
        this.o = o;

        this.actor = new St.BoxLayout({ vertical: true });

        let cmdTxt = new St.Label({ text: command });
        cmdTxt.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this.actor.add(cmdTxt);
        let box = new St.BoxLayout({});
        this.actor.add(box);
        let resultTxt = new St.Label({ text: 'r(' + index + ') = ' });
        resultTxt.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        box.add(resultTxt);
        let objLink = new ObjLink(o);
        box.add(objLink.actor);
        let line = new Clutter.Rectangle({ name: 'Separator' });
        let padBin = new St.Bin({ name: 'Separator', x_fill: true, y_fill: true });
        padBin.add_actor(line);
        this.actor.add(padBin);
    }
};

function WindowList() {
    this._init();
}

WindowList.prototype = {
    _init : function () {
        this.actor = new St.BoxLayout({ name: 'Windows', vertical: true, style: 'spacing: 8px' });
        let display = global.screen.get_display();
        let tracker = Shell.WindowTracker.get_default();
        this._updateId = Main.initializeDeferredWork(this.actor, Lang.bind(this, this._updateWindowList));
        display.connect('window-created', Lang.bind(this, this._updateWindowList));
        tracker.connect('tracked-windows-changed', Lang.bind(this, this._updateWindowList));
    },

    _updateWindowList: function() {
        this.actor.get_children().forEach(function (actor) { actor.destroy(); });
        let windows = global.get_windows();
        let tracker = Shell.WindowTracker.get_default();
        for (let i = 0; i < windows.length; i++) {
            let metaWindow = windows[i].metaWindow;
            // Avoid multiple connections
            if (!metaWindow._lookingGlassManaged) {
                metaWindow.connect('unmanaged', Lang.bind(this, this._updateWindowList));
                metaWindow._lookingGlassManaged = true;
            }
            let box = new St.BoxLayout({ vertical: true });
            this.actor.add(box);
            let windowLink = new ObjLink(metaWindow, metaWindow.title);
            box.add(windowLink.actor, { x_align: St.Align.START, x_fill: false });
            let propsBox = new St.BoxLayout({ vertical: true, style: 'padding-left: 6px;' });
            box.add(propsBox);
            propsBox.add(new St.Label({ text: 'wmclass: ' + metaWindow.get_wm_class() }));
            let app = tracker.get_window_app(metaWindow);
            if (app != null && !app.is_transient()) {
                let icon = app.create_icon_texture(22);
                let propBox = new St.BoxLayout({ style: 'spacing: 6px; ' });
                propsBox.add(propBox);
                propBox.add(new St.Label({ text: 'app: ' }), { y_fill: false });
                let appLink = new ObjLink(app, app.get_id());
                propBox.add(appLink.actor, { y_fill: false });
                propBox.add(icon, { y_fill: false });
            } else {
                propsBox.add(new St.Label({ text: '<untracked>' }));
            }
        }
    }
};
Signals.addSignalMethods(WindowList.prototype);

function ObjInspector() {
    this._init();
}

ObjInspector.prototype = {
    _init : function () {
        this._obj = null;
        this._previousObj = null;

        this._parentList = [];

        this.actor = new St.ScrollView({ x_fill: true, y_fill: true });
        this.actor.get_hscroll_bar().hide();
        this._container = new St.BoxLayout({ name: 'LookingGlassPropertyInspector',
                                             style_class: 'lg-dialog',
                                             vertical: true });
        this.actor.add_actor(this._container);
    },

    selectObject: function(obj, skipPrevious) {
        if (!skipPrevious)
            this._previousObj = this._obj;
        else
            this._previousObj = null;
        this._obj = obj;

        this._container.get_children().forEach(function (child) { child.destroy(); });

        let hbox = new St.BoxLayout({ style_class: 'lg-obj-inspector-title' });
        this._container.add_actor(hbox);
        let label = new St.Label({ text: 'Inspecting: %s: %s'.format(typeof(obj),
                                                                     objectToString(obj)) });
        label.single_line_mode = true;
        hbox.add(label, { expand: true, y_fill: false });
        let button = new St.Button({ label: 'Insert', style_class: 'lg-obj-inspector-button' });
        button.connect('clicked', Lang.bind(this, this._onInsert));
        hbox.add(button);

        if (this._previousObj != null) {
            button = new St.Button({ label: 'Back', style_class: 'lg-obj-inspector-button' });
            button.connect('clicked', Lang.bind(this, this._onBack));
            hbox.add(button);
        }

        button = new St.Button({ style_class: 'window-close' });
        button.connect('clicked', Lang.bind(this, this.close));
        hbox.add(button);
        if (typeof(obj) == typeof({})) {
            for (let propName in obj) {
                let valueStr;
                let link;
                try {
                    let prop = obj[propName];
                    link = new ObjLink(prop).actor;
                } catch (e) {
                    link = new St.Label({ text: '<error>' });
                }
                let hbox = new St.BoxLayout();
                let propText = propName + ": " + valueStr;
                hbox.add(new St.Label({ text: propName + ': ' }));
                hbox.add(link);
                this._container.add_actor(hbox);
            }
        }
    },

    open: function(sourceActor) {
        if (this._open)
            return;
        this._previousObj = null;
        this._open = true;
        this.actor.show();
        if (sourceActor) {
            this.actor.set_scale(0, 0);
            let [sourceX, sourceY] = sourceActor.get_transformed_position();
            let [sourceWidth, sourceHeight] = sourceActor.get_transformed_size();
            this.actor.move_anchor_point(Math.floor(sourceX + sourceWidth / 2),
                                         Math.floor(sourceY + sourceHeight / 2));
            Tweener.addTween(this.actor, { scale_x: 1, scale_y: 1,
                                           transition: "easeOutQuad",
                                           time: 0.2 });
        } else {
            this.actor.set_scale(1, 1);
        }
    },

    close: function() {
        if (!this._open)
            return;
        this._open = false;
        this.actor.hide();
        this._previousObj = null;
        this._obj = null;
    },

    _onInsert: function() {
        let obj = this._obj;
        this.close();
        Main.lookingGlass.insertObject(obj);
    },

    _onBack: function() {
        this.selectObject(this._previousObj, true);
    }
};

function Inspector() {
    this._init();
}

Inspector.prototype = {
    _init: function() {
        let width = 150;
        let primary = global.get_primary_monitor();
        let eventHandler = new St.BoxLayout({ name: 'LookingGlassDialog',
                                              vertical: false,
                                              y: primary.y + Math.floor(primary.height / 2),
                                              reactive: true });
        eventHandler.connect('notify::allocation', Lang.bind(this, function () {
            eventHandler.x = primary.x + Math.floor((primary.width - eventHandler.width) / 2);
        }));
        Main.uiGroup.add_actor(eventHandler);
        let displayText = new St.Label();
        eventHandler.add(displayText, { expand: true });

        let borderPaintTarget = null;
        let borderPaintId = null;
        eventHandler.connect('destroy', Lang.bind(this, function() {
            if (borderPaintTarget != null)
                borderPaintTarget.disconnect(borderPaintId);
        }));

        eventHandler.connect('button-press-event', Lang.bind(this, function (actor, event) {
            Clutter.ungrab_pointer(eventHandler);

            let [stageX, stageY] = event.get_coords();
            let target = global.stage.get_actor_at_pos(Clutter.PickMode.ALL,
                                                       stageX,
                                                       stageY);
            this.emit('target', target, stageX, stageY);
            eventHandler.destroy();
            this.emit('closed');
            return true;
        }));

        eventHandler.connect('motion-event', Lang.bind(this, function (actor, event) {
            let [stageX, stageY] = event.get_coords();
            let target = global.stage.get_actor_at_pos(Clutter.PickMode.ALL,
                                                       stageX,
                                                       stageY);
            let id, style_class;
            if (target instanceof St.Widget) {
                id = target.get_theme_node().get_element_id();
                style_class = target.get_theme_node().get_element_class();
            }
            let position = '<inspect x: ' + stageX + ' y: ' + stageY + '>';
            let style = '<style id: ' + id  + ' class: ' + style_class + '>';
            displayText.text = position + ' ' + style + ' ' + target;
            if (borderPaintTarget != null)
                borderPaintTarget.disconnect(borderPaintId);
            borderPaintTarget = target;
            borderPaintId = Shell.add_hook_paint_red_border(target);
            return true;
        }));
        Clutter.grab_pointer(eventHandler);
    }
};

Signals.addSignalMethods(Inspector.prototype);

function ErrorLog() {
    this._init();
}

ErrorLog.prototype = {
    _init: function() {
        this.actor = new St.BoxLayout();
        this.text = new St.Label();
        this.actor.add(this.text);
        this.text.clutter_text.line_wrap = true;
        this.actor.connect('notify::mapped', Lang.bind(this, this._renderText));
    },

    _formatTime: function(d){
        function pad(n) { return n < 10 ? '0' + n : n; }
        return d.getUTCFullYear()+'-'
            + pad(d.getUTCMonth()+1)+'-'
            + pad(d.getUTCDate())+'T'
            + pad(d.getUTCHours())+':'
            + pad(d.getUTCMinutes())+':'
            + pad(d.getUTCSeconds())+'Z';
    },

    _renderText: function() {
        if (!this.actor.mapped)
            return;
        let text = this.text.text;
        let stack = Main._getAndClearErrorStack();
        for (let i = 0; i < stack.length; i++) {
            let logItem = stack[i];
            text += logItem.category + ' t=' + this._formatTime(new Date(logItem.timestamp)) + ' ' + logItem.message + '\n';
        }
        this.text.text = text;
    }
};

function Extensions() {
    this._init();
}

Extensions.prototype = {
    _init: function() {
        this.actor = new St.BoxLayout({ vertical: true,
                                        name: 'lookingGlassExtensions' });
        this._noExtensions = new St.Label({ style_class: 'lg-extensions-none',
                                             text: _("No extensions installed") });
        this._extensionsList = new St.BoxLayout({ vertical: true,
                                                  style_class: 'lg-extensions-list' });
        this.actor.add(this._extensionsList);
        this._loadExtensionList();
    },

    _loadExtensionList: function() {
        let extensions = ExtensionSystem.extensionMeta;
        let totalExtensions = 0;
        for (let uuid in extensions) {
            let extensionDisplay = this._createExtensionDisplay(extensions[uuid]);
            this._extensionsList.add(extensionDisplay);
            totalExtensions++;
        }
        if (totalExtensions == 0) {
            this._extensionsList.add(this._noExtensions);
        }
    },

    _onViewSource: function (actor) {
        let meta = actor._extensionMeta;
        let file = Gio.file_new_for_path(meta.path);
        let uri = file.get_uri();
        Gio.app_info_launch_default_for_uri(uri, global.create_app_launch_context());
        Main.lookingGlass.close();
    },

    _onWebPage: function (actor) {
        let meta = actor._extensionMeta;
        Gio.app_info_launch_default_for_uri(meta.url, global.create_app_launch_context());
        Main.lookingGlass.close();
    },

    _stateToString: function(extensionState) {
        switch (extensionState) {
            case ExtensionSystem.ExtensionState.ENABLED:
                return _("Enabled");
            case ExtensionSystem.ExtensionState.DISABLED:
                return _("Disabled");
            case ExtensionSystem.ExtensionState.ERROR:
                return _("Error");
            case ExtensionSystem.ExtensionState.OUT_OF_DATE:
                return _("Out of date");
        }
        return 'Unknown'; // Not translated, shouldn't appear
    },

    _createExtensionDisplay: function(meta) {
        let box = new St.BoxLayout({ style_class: 'lg-extension', vertical: true });
        let name = new St.Label({ style_class: 'lg-extension-name',
                                   text: meta.name });
        box.add(name, { expand: true });
        let description = new St.Label({ style_class: 'lg-extension-description',
                                         text: meta.description });
        box.add(description, { expand: true });

        let metaBox = new St.BoxLayout();
        box.add(metaBox);
        let stateString = this._stateToString(meta.state);
        let state = new St.Label({ style_class: 'lg-extension-state',
                                   text: this._stateToString(meta.state) });

        let actionsContainer = new St.Bin({ x_align: St.Align.END });
        metaBox.add(actionsContainer);
        let actionsBox = new St.BoxLayout({ style_class: 'lg-extension-actions' });
        actionsContainer.set_child(actionsBox);

        let viewsource = new Link.Link({ label: _("View Source") });
        viewsource.actor._extensionMeta = meta;
        viewsource.actor.connect('clicked', Lang.bind(this, this._onViewSource));
        actionsBox.add(viewsource.actor);

        if (meta.url) {
            let webpage = new Link.Link({ label: _("Web Page") });
            webpage.actor._extensionMeta = meta;
            webpage.actor.connect('clicked', Lang.bind(this, this._onWebPage));
            actionsBox.add(webpage.actor);
        }

        return box;
    }
};

function LookingGlass() {
    this._init();
}

LookingGlass.prototype = {
    _init : function() {
        this._idleHistorySaveId = 0;
        let historyPath = global.userdatadir + '/lookingglass-history.txt';
        this._historyFile = Gio.file_new_for_path(historyPath);
        this._savedText = null;
        this._historyNavIndex = -1;
        this._history = [];
        this._borderPaintTarget = null;
        this._borderPaintId = 0;
        this._borderDestroyId = 0;

        this._readHistory();

        this._open = false;

        this._offset = 0;
        this._results = [];

        // Sort of magic, but...eh.
        this._maxItems = 150;

        this.actor = new St.BoxLayout({ name: 'LookingGlassDialog',
                                        style_class: 'lg-dialog',
                                        vertical: true,
                                        visible: false });

        let gconf = Shell.GConf.get_default();
        gconf.watch_directory('/desktop/gnome/interface');
        gconf.connect('changed::/desktop/gnome/interface/monospace_font_name',
                      Lang.bind(this, this._updateFont));
        this._updateFont();

        Main.uiGroup.add_actor(this.actor);

        this._objInspector = new ObjInspector();
        Main.uiGroup.add_actor(this._objInspector.actor);
        this._objInspector.actor.hide();

        let toolbar = new St.BoxLayout({ name: 'Toolbar' });
        this.actor.add_actor(toolbar);
        let inspectIcon = St.TextureCache.get_default().load_gicon(new Gio.ThemedIcon({ name: 'gtk-color-picker' }),
                                                                   24);
        toolbar.add_actor(inspectIcon);
        inspectIcon.reactive = true;
        inspectIcon.connect('button-press-event', Lang.bind(this, function () {
            let inspector = new Inspector();
            inspector.connect('target', Lang.bind(this, function(i, target, stageX, stageY) {
                this._pushResult('<inspect x:' + stageX + ' y:' + stageY + '>',
                                 target);
            }));
            inspector.connect('closed', Lang.bind(this, function() {
                this.actor.show();
                global.stage.set_key_focus(this._entry);
            }));
            this.actor.hide();
            return true;
        }));

        let notebook = new Notebook();
        this._notebook = notebook;
        this.actor.add(notebook.actor, { expand: true });

        let emptyBox = new St.Bin();
        toolbar.add(emptyBox, { expand: true });
        toolbar.add_actor(notebook.tabControls);

        this._evalBox = new St.BoxLayout({ name: 'EvalBox', vertical: true });
        notebook.appendPage('Evaluator', this._evalBox);

        this._resultsArea = new St.BoxLayout({ name: 'ResultsArea', vertical: true });
        this._evalBox.add(this._resultsArea, { expand: true });

        let entryArea = new St.BoxLayout({ name: 'EntryArea' });
        this._evalBox.add_actor(entryArea);

        let label = new St.Label({ text: 'js>>> ' });
        entryArea.add(label);

        this._entry = new St.Entry();
        /* unmapping the edit box will un-focus it, undo that */
        notebook.connect('selection', Lang.bind(this, function (nb, child) {
            if (child == this._evalBox)
                global.stage.set_key_focus(this._entry);
        }));
        entryArea.add(this._entry, { expand: true });

        this._windowList = new WindowList();
        this._windowList.connect('selected', Lang.bind(this, function(list, window) {
            notebook.selectIndex(0);
            this._pushResult('<window selection>', window);
        }));
        notebook.appendPage('Windows', this._windowList.actor);

        this._errorLog = new ErrorLog();
        notebook.appendPage('Errors', this._errorLog.actor);

        this._extensions = new Extensions();
        notebook.appendPage('Extensions', this._extensions.actor);

        this._entry.clutter_text.connect('activate', Lang.bind(this, function (o, e) {
            let text = o.get_text();
            // Ensure we don't get newlines in the command; the history file is
            // newline-separated.
            text.replace('\n', ' ');
            // Strip leading and trailing whitespace
            text = text.replace(/^\s+/g, '').replace(/\s+$/g, '');
            if (text == '')
                return true;
            this._evaluate(text);
            this._historyNavIndex = -1;
            return true;
        }));
        this._entry.clutter_text.connect('key-press-event', Lang.bind(this, function(o, e) {
            let symbol = e.get_key_symbol();
            if (symbol == Clutter.Up) {
                if (this._historyNavIndex >= this._history.length - 1)
                    return true;
                this._historyNavIndex++;
                if (this._historyNavIndex == 0)
                    this._savedText = this._entry.text;
                this._entry.text = this._history[this._history.length - this._historyNavIndex - 1];
                return true;
            } else if (symbol == Clutter.Down) {
                if (this._historyNavIndex <= 0)
                    return true;
                this._historyNavIndex--;
                if (this._historyNavIndex < 0)
                    this._entry.text = this._savedText;
                else
                    this._entry.text = this._history[this._history.length - this._historyNavIndex - 1];
                return true;
            } else {
                this._historyNavIndex = -1;
                this._savedText = null;
                return false;
            }
        }));
    },

    _updateFont: function() {
        let gconf = Shell.GConf.get_default();
        let fontName = gconf.get_string('/desktop/gnome/interface/monospace_font_name');
        // This is mishandled by the scanner - should by Pango.FontDescription_from_string(fontName);
        // https://bugzilla.gnome.org/show_bug.cgi?id=595889
        let fontDesc = Pango.Font.description_from_string(fontName);
        // We ignore everything but size and style; you'd be crazy to set your system-wide
        // monospace font to be bold/oblique/etc. Could easily be added here.
        this.actor.style =
            'font-size: ' + fontDesc.get_size() / 1024. + (fontDesc.get_size_is_absolute() ? 'px' : 'pt') + ';'
            + 'font-family: "' + fontDesc.get_family() + '";';
    },

    _readHistory: function () {
        if (!this._historyFile.query_exists(null))
            return;
        let [result, contents, length, etag] = this._historyFile.load_contents(null);
        this._history = contents.split('\n').filter(function (e) { return e != ''; });
    },

    _queueHistorySave: function() {
        if (this._idleHistorySaveId > 0)
            return;
        this._idleHistorySaveId = Mainloop.timeout_add_seconds(5, Lang.bind(this, this._doSaveHistory));
    },

    _doSaveHistory: function () {
        this._idleHistorySaveId = false;
        let output = this._historyFile.replace(null, true, Gio.FileCreateFlags.NONE, null);
        let dataOut = new Gio.DataOutputStream({ base_stream: output });
        dataOut.put_string(this._history.join('\n'), null);
        dataOut.put_string('\n', null);
        dataOut.close(null);
        return false;
    },

    _pushResult: function(command, obj) {
        let index = this._results.length + this._offset;
        let result = new Result('>>> ' + command, obj, index);
        this._results.push(result);
        this._resultsArea.add(result.actor);
        if (this._borderPaintTarget != null) {
            this._borderPaintTarget.disconnect(this._borderPaintId);
            this._borderPaintTarget = null;
        }
        if (obj instanceof Clutter.Actor) {
            this._borderPaintTarget = obj;
            this._borderPaintId = Shell.add_hook_paint_red_border(obj);
            this._borderDestroyId = obj.connect('destroy', Lang.bind(this, function () {
                this._borderDestroyId = 0;
                this._borderPaintTarget = null;
            }));
        }
        let children = this._resultsArea.get_children();
        if (children.length > this._maxItems) {
            this._results.shift();
            children[0].destroy();
            this._offset++;
        }
        this._it = obj;

        // Scroll to bottom
        this._notebook.scrollToBottom(0);
    },

    _evaluate : function(command) {
        this._history.push(command);
        this._queueHistorySave();

        let fullCmd = commandHeader + command;

        let resultObj;
        try {
            resultObj = eval(fullCmd);
        } catch (e) {
            resultObj = '<exception ' + e + '>';
        }

        this._pushResult(command, resultObj);
        this._entry.text = '';
    },

    getIt: function () {
        return this._it;
    },

    getResult: function(idx) {
        return this._results[idx - this._offset].o;
    },

    toggle: function() {
        if (this._open)
            this.close();
        else
            this.open();
    },

    _resizeTo: function(actor) {
        let primary = global.get_primary_monitor();
        let myWidth = primary.width * 0.7;
        let myHeight = primary.height * 0.7;
        let [srcX, srcY] = actor.get_transformed_position();
        this.actor.x = srcX + (primary.width - myWidth) / 2;
        this._hiddenY = srcY + actor.height - myHeight - 4; // -4 to hide the top corners
        this._targetY = this._hiddenY + myHeight;
        this.actor.y = this._hiddenY;
        this.actor.width = myWidth;
        this.actor.height = myHeight;
        this._objInspector.actor.set_size(Math.floor(myWidth * 0.8), Math.floor(myHeight * 0.8));
        this._objInspector.actor.set_position(this.actor.x + Math.floor(myWidth * 0.1),
                                              this._targetY + Math.floor(myHeight * 0.1));
    },

    slaveTo: function(actor) {
        this._slaveTo = actor;
        actor.connect('notify::allocation', Lang.bind(this, function () {
            this._resizeTo(actor);
        }));
        this._resizeTo(actor);
    },

    insertObject: function(obj) {
        this._pushResult('<insert>', obj);
    },

    inspectObject: function(obj, sourceActor) {
        this._objInspector.open(sourceActor);
        this._objInspector.selectObject(obj);
    },

    // Handle key events which are relevant for all tabs of the LookingGlass
    _globalKeyPressEvent : function(actor, event) {
        let symbol = event.get_key_symbol();
        if (symbol == Clutter.Escape) {
            if (this._objInspector.actor.visible) {
                this._objInspector.close();
            } else {
                this.close();
            }
            return true;
        }
        return false;
    },

    open : function() {
        if (this._open)
            return;

        if (!Main.pushModal(this.actor))
            return;

        this._keyPressEventId = global.stage.connect('key-press-event',
            Lang.bind(this, this._globalKeyPressEvent));

        this.actor.show();
        this.actor.lower(Main.chrome.actor);
        this._open = true;

        Tweener.removeTweens(this.actor);

        global.stage.set_key_focus(this._entry);

        Tweener.addTween(this.actor, { time: 0.5,
                                       transition: 'easeOutQuad',
                                       y: this._targetY
                                     });
    },

    close : function() {
        if (!this._open)
            return;

        if (this._keyPressEventId)
            global.stage.disconnect(this._keyPressEventId);

        this._objInspector.actor.hide();

        this._historyNavIndex = -1;
        this._open = false;
        Tweener.removeTweens(this.actor);

        if (this._borderPaintTarget != null) {
            this._borderPaintTarget.disconnect(this._borderPaintId);
            this._borderPaintTarget.disconnect(this._borderDestroyId);
            this._borderPaintTarget = null;
        }

        Main.popModal(this.actor);

        Tweener.addTween(this.actor, { time: 0.5,
                                       transition: 'easeOutQuad',
                                       y: this._hiddenY,
                                       onComplete: Lang.bind(this, function () {
                                           this.actor.hide();
                                       })
                                     });
    }
};
Signals.addSignalMethods(LookingGlass.prototype);
