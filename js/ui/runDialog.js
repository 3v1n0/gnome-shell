/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

const Big = imports.gi.Big;
const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;
const Signals = imports.signals;
const St = imports.gi.St;
const Gettext = imports.gettext.domain('gnome-shell');
const _ = Gettext.gettext;

const Lightbox = imports.ui.lightbox;
const Main = imports.ui.main;

const MAX_FILE_DELETED_BEFORE_INVALID = 10;

function CommandCompleter() {
    this._init();
}

CommandCompleter.prototype = {
    _init : function() {
        this._changedCount = 0;
        this._paths = GLib.getenv('PATH').split(':');
        this._valid = false;
        this._updateInProgress = false;
        this._childs = new Array(this._paths.length);
        this._monitors = new Array(this._paths.length);
        for (let i = 0; i < this._paths.length; i++) {
            this._childs[i] = [];
            let file = Gio.file_new_for_path(this._paths[i]);
            let info;
            try {
                info = file.query_info(Gio.FILE_ATTRIBUTE_STANDARD_TYPE, Gio.FileQueryInfoFlags.NONE, null);
            } catch (e) {
                // FIXME catchall
                this._paths[i] = null;
                continue;
            }

            if (info.get_attribute_uint32(Gio.FILE_ATTRIBUTE_STANDARD_TYPE) != Gio.FileType.DIRECTORY)
                continue;

            this._paths[i] = file.get_path();
            this._monitors[i] = file.monitor_directory(Gio.FileMonitorFlags.NONE, null);
            if (this._monitors[i] != null) {
                this._monitors[i].connect("changed", Lang.bind(this, this._onChanged));
            }
        }
        this._paths = this._paths.filter(function(a) {
            return a != null;
        });
        this._update(0);
    },

    _onGetEnumerateComplete : function(obj, res) {
        this._enumerator = obj.enumerate_children_finish(res);
        this._enumerator.next_files_async(100, GLib.PRIORITY_LOW, null, Lang.bind(this, this._onNextFileComplete), null);
    },

    _onNextFileComplete : function(obj, res) {
        let files = obj.next_files_finish(res);
        for (let i = 0; i < files.length; i++) {
            this._childs[this._i].push(files[i].get_name());
        }
        if (files.length) {
            this._enumerator.next_files_async(100, GLib.PRIORITY_LOW, null, Lang.bind(this, this._onNextFileComplete), null);
        } else {
            this._enumerator.close(null);
            this._enumerator = null;
            this._update(this._i + 1);
        }
    },

    update : function() {
        if (this._valid)
            return;
        this._update(0);
    },

    _update : function(i) {
        if (i == 0 && this._updateInProgress)
            return;
        this._updateInProgress = true;
        this._changedCount = 0;
        this._i = i;
        if (i >= this._paths.length) {
            this._valid = true;
            this._updateInProgress = false;
            return;
        }
        let file = Gio.file_new_for_path(this._paths[i]);
        this._childs[this._i] = [];
        file.enumerate_children_async(Gio.FILE_ATTRIBUTE_STANDARD_NAME, Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_LOW, null, Lang.bind(this, this._onGetEnumerateComplete), null);
    },

    _onChanged : function(m, f, of, type) {
        if (!this._valid)
            return;
        let path = f.get_parent().get_path();
        let k = undefined;
        for (let i = 0; i < this._paths.length; i++) {
            if (this._paths[i] == path)
                k = i;
        }
        if (k === undefined) {
            return;
        }
        if (type == Gio.FileMonitorEvent.CREATED) {
            this._childs[k].push(f.get_basename());
        }
        if (type == Gio.FileMonitorEvent.DELETED) {
            this._changedCount++;
            if (this._changedCount > MAX_FILE_DELETED_BEFORE_INVALID) {
                this._valid = false;
            }
            let name = f.get_basename();
            this._childs[k] = this._childs[k].filter(function(e) {
                return e != name;
            });
        }
        if (type == Gio.FileMonitorEvent.UNMOUNTED) {
            this._childs[k] = [];
        }
    },

    getCompletion: function(text) {
        let common = "";
        let notInit = true;
        if (!this._valid) {
            this._update(0);
            return common;
        }
        function _getCommon(s1, s2) {
            let k = 0;
            for (; k < s1.length && k < s2.length; k++) {
                if (s1[k] != s2[k])
                    break;
            }
            if (k == 0)
                return "";
            return s1.substr(0, k);
        }
        function _hasPrefix(s1, prefix) {
            return s1.indexOf(prefix) == 0;
        }
        for (let i = 0; i < this._childs.length; i++) {
            for (let k = 0; k < this._childs[i].length; k++) {
                if (!_hasPrefix(this._childs[i][k], text))
                    continue;
                if (notInit) {
                    common = this._childs[i][k];
                    notInit = false;
                }
                common = _getCommon(common, this._childs[i][k]);
            }
        }
        if (common.length)
            return common.substr(text.length);
        return common;
    }
};

function RunDialog() {
    this._init();
};

RunDialog.prototype = {
    _init : function() {
        this._isOpen = false;

        let gconf = Shell.GConf.get_default();
        gconf.connect('changed::development_tools', Lang.bind(this, function () {
            this._enableInternalCommands = gconf.get_boolean('development_tools');
        }));
        this._enableInternalCommands = gconf.get_boolean('development_tools');

        this._internalCommands = { 'lg':
                                   Lang.bind(this, function() {
                                       Main.createLookingGlass().open();
                                   }),

                                   'r': Lang.bind(this, function() {
                                       global.reexec_self();
                                   }),

                                   // Developer brain backwards compatibility
                                   'restart': Lang.bind(this, function() {
                                       global.reexec_self();
                                   }),

                                   'debugexit': Lang.bind(this, function() {
                                       Meta.exit(Meta.ExitCode.ERROR);
                                   })
                                 };

        // All actors are inside _group. We create it initially
        // hidden then show it in show()
        this._group = new Clutter.Group({ visible: false,
                                          x: 0, y: 0 });
        global.stage.add_actor(this._group);

        let lightbox = new Lightbox.Lightbox(this._group, true);

        this._box = new St.Bin({ x_align: St.Align.MIDDLE,
                                 y_align: St.Align.MIDDLE });

        this._group.add_actor(this._box);
        lightbox.highlight(this._box);

        let dialogBox = new St.BoxLayout({ style_class: 'run-dialog', vertical: true });

        this._box.set_child(dialogBox);

        let label = new St.Label({ style_class: 'run-dialog-label',
                                   text: _("Please enter a command:") });

        dialogBox.add(label, { expand: true, y_fill: false });

        let entry = new St.Entry({ style_class: 'run-dialog-entry' });

        this._entryText = entry.clutter_text;
        dialogBox.add(entry, { expand: true });

        this._errorBox = new St.BoxLayout();

        dialogBox.add(this._errorBox, { expand: true });

        let errorIcon = new St.Button({ style_class: 'run-dialog-error-icon' });

        this._errorBox.add(errorIcon);

        this._commandError = false;

        this._errorMessage = new St.Label({ style_class: 'run-dialog-error-label' });
        this._errorMessage.clutter_text.line_wrap = true;

        this._errorBox.add(this._errorMessage, { expand: true });

        this._errorBox.hide();

        this._pathCompleter = new Gio.FilenameCompleter();
        this._commandCompleter = new CommandCompleter();
        this._group.connect('notify::visible', Lang.bind(this._commandCompleter, this._commandCompleter.update));
        this._entryText.connect('key-press-event', Lang.bind(this, function(o, e) {
            let symbol = e.get_key_symbol();
            if (symbol == Clutter.Return) {
                if (e.get_state() & Clutter.ModifierType.CONTROL_MASK)
                    this._run(o.get_text(), true);
                else
                    this._run(o.get_text(), false);
                if (!this._commandError)
                    this.close();
            }
            if (symbol == Clutter.Escape) {
                this.close();
                return true;
            }
            if (symbol == Clutter.slash) {
                // Need preload data before get completion. GFilenameCompleter load content of parent directory.
                // Parent directory for /usr/include/ is /usr/. So need to add fake name('a').
                let text = o.get_text().concat('/a');
                let prefix;
                if (text.lastIndexOf(' ') == -1)
                    prefix = text;
                else
                    prefix = text.substr(text.lastIndexOf(' ') + 1);
                this._getCompletion(prefix);
                return false;
            }
            if (symbol == Clutter.Tab) {
                let text = o.get_text();
                let prefix;
                if (text.lastIndexOf(' ') == -1)
                    prefix = text;
                else
                    prefix = text.substr(text.lastIndexOf(' ') + 1);
                let postfix = this._getCompletion(prefix);
                if (postfix != null && postfix.length > 0) {
                    o.insert_text(postfix, -1);
                    o.set_cursor_position(text.length + postfix.length);
                    if (postfix[postfix.length - 1] == '/')
                        this._getCompletion(text + postfix + 'a');
                }
                return true;
            }
            return false;
        }));
    },

    _getCompletion : function(text) {
        if (text.indexOf('/') != -1) {
            return this._pathCompleter.get_completion_suffix(text);
        } else {
            return this._commandCompleter.getCompletion(text);
        }
    },

    _run : function(command, inTerminal) {
        this._commandError = false;
        let f;
        if (this._enableInternalCommands)
            f = this._internalCommands[command];
        else
            f = null;
        if (f) {
            f();
        } else if (command) {
            try {
                if (inTerminal)
                    command = 'gnome-terminal -x ' + command;
                let [ok, len, args] = GLib.shell_parse_argv(command);
                let p = new Shell.Process({ 'args' : args });
                p.run();
            } catch (e) {
                this._commandError = true;
                /*
                 * The exception contains an error string like:
                 * Error invoking Shell.run: Failed to execute child process "foo"
                 * (No such file or directory)
                 * We are only interested in the actual error, so parse that out.
                 */
                let m = /.+\((.+)\)/.exec(e);
                let errorStr = _("Execution of '%s' failed:").format(command) + "\n" + m[1];
                this._errorMessage.set_text(errorStr);

                this._errorBox.show();
                // preferred_size change. Without this, message will show with delay
                this._errorBox.get_parent().queue_relayout();
            }
        }
    },

    open : function() {
        if (this._isOpen) // Already shown
            return;

        if (!Main.pushModal(this._group))
            return;

        // Position the dialog on the current monitor
        let monitor = global.get_focus_monitor();

        this._box.set_position(monitor.x, monitor.y);
        this._box.set_size(monitor.width, monitor.height);

        this._isOpen = true;
        this._group.show();

        global.stage.set_key_focus(this._entryText);
    },

    close : function() {
        if (!this._isOpen)
            return;

        this._isOpen = false;

        this._errorBox.hide();
        this._commandError = false;

        this._group.hide();
        this._entryText.set_text('');

        Main.popModal(this._group);
    }
};
Signals.addSignalMethods(RunDialog.prototype);
