/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

const Clutter = imports.gi.Clutter;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;
const St = imports.gi.St;

const AltTab = imports.ui.altTab;
const WorkspaceSwitcherPopup = imports.ui.workspaceSwitcherPopup;
const Main = imports.ui.main;
const Tweener = imports.ui.tweener;

const WINDOW_ANIMATION_TIME = 0.25;

function WindowManager() {
    this._init();
}

WindowManager.prototype = {
    _init : function() {
        this._shellwm =  global.window_manager;

        this._keyBindingHandlers = [];
        this._minimizing = [];
        this._maximizing = [];
        this._unmaximizing = [];
        this._mapping = [];
        this._destroying = [];

        this._switchData = null;
        this._shellwm.connect('switch-workspace', Lang.bind(this, this._switchWorkspace));
        this._shellwm.connect('kill-switch-workspace', Lang.bind(this, this._switchWorkspaceDone));
        this._shellwm.connect('minimize', Lang.bind(this, this._minimizeWindow));
        this._shellwm.connect('kill-minimize', Lang.bind(this, this._minimizeWindowDone));
        this._shellwm.connect('maximize', Lang.bind(this, this._maximizeWindow));
        this._shellwm.connect('kill-maximize', Lang.bind(this, this._maximizeWindowDone));
        this._shellwm.connect('unmaximize', Lang.bind(this, this._unmaximizeWindow));
        this._shellwm.connect('kill-unmaximize', Lang.bind(this, this._unmaximizeWindowDone));
        this._shellwm.connect('map', Lang.bind(this, this._mapWindow));
        this._shellwm.connect('kill-map', Lang.bind(this, this._mapWindowDone));
        this._shellwm.connect('destroy', Lang.bind(this, this._destroyWindow));
        this._shellwm.connect('kill-destroy', Lang.bind(this, this._destroyWindowDone));

        this._workspaceSwitcherPopup = null;
        this.setKeybindingHandler('switch_to_workspace_left', Lang.bind(this, this._showWorkspaceSwitcher));
        this.setKeybindingHandler('switch_to_workspace_right', Lang.bind(this, this._showWorkspaceSwitcher));
        this.setKeybindingHandler('switch_to_workspace_up', Lang.bind(this, this._showWorkspaceSwitcher));
        this.setKeybindingHandler('switch_to_workspace_down', Lang.bind(this, this._showWorkspaceSwitcher));
        this.setKeybindingHandler('switch_windows', Lang.bind(this, this._startAppSwitcher));
    },

    setKeybindingHandler: function(keybinding, handler){
        if (this._keyBindingHandlers[keybinding])
            this._shellwm.disconnect(this._keyBindingHandlers[keybinding]);
        else
            this._shellwm.takeover_keybinding(keybinding);

        this._keyBindingHandlers[keybinding] =
            this._shellwm.connect('keybinding::' + keybinding, handler);
    },

    _shouldAnimate : function(actor) {
        if (Main.overview.visible)
            return false;
        if (actor && (actor.get_window_type() != Meta.CompWindowType.NORMAL))
            return false;
        return true;
    },

    _removeEffect : function(list, actor) {
        let idx = list.indexOf(actor);
        if (idx != -1) {
            list.splice(idx, 1);
            return true;
        }
        return false;
    },

    _minimizeWindow : function(shellwm, actor) {
        if (!this._shouldAnimate(actor)) {
            shellwm.completed_minimize(actor);
            return;
        }

        actor.set_scale(1.0, 1.0);
        actor.move_anchor_point_from_gravity(Clutter.Gravity.CENTER);

        /* scale window down to 0x0.
         * maybe TODO: get icon geometry passed through and move the window towards it?
         */
        this._minimizing.push(actor);

        let primary = global.get_primary_monitor();
        let xDest = primary.x;
        if (St.Widget.get_default_direction() == St.TextDirection.RTL)
            xDest += primary.width;

        Tweener.addTween(actor,
                         { scale_x: 0.0,
                           scale_y: 0.0,
                           x: xDest,
                           y: 0,
                           time: WINDOW_ANIMATION_TIME,
                           transition: "easeOutQuad",
                           onComplete: this._minimizeWindowDone,
                           onCompleteScope: this,
                           onCompleteParams: [shellwm, actor],
                           onOverwrite: this._minimizeWindowOverwritten,
                           onOverwriteScope: this,
                           onOverwriteParams: [shellwm, actor]
                         });
    },

    _minimizeWindowDone : function(shellwm, actor) {
        if (this._removeEffect(this._minimizing, actor)) {
            Tweener.removeTweens(actor);
            actor.set_scale(1.0, 1.0);
            actor.move_anchor_point_from_gravity(Clutter.Gravity.NORTH_WEST);

            shellwm.completed_minimize(actor);
        }
    },

    _minimizeWindowOverwritten : function(shellwm, actor) {
        if (this._removeEffect(this._minimizing, actor)) {
            shellwm.completed_minimize(actor);
        }
    },

    _maximizeWindow : function(shellwm, actor, targetX, targetY, targetWidth, targetHeight) {
        shellwm.completed_maximize(actor);
    },

    _maximizeWindowDone : function(shellwm, actor) {
    },

    _maximizeWindowOverwrite : function(shellwm, actor) {
    },

    _unmaximizeWindow : function(shellwm, actor, targetX, targetY, targetWidth, targetHeight) {
        shellwm.completed_unmaximize(actor);
    },

    _unmaximizeWindowDone : function(shellwm, actor) {
    },

    _mapWindow : function(shellwm, actor) {
        if (!this._shouldAnimate(actor)) {
            shellwm.completed_map(actor);
            return;
        }

        actor.move_anchor_point_from_gravity(Clutter.Gravity.CENTER);
        actor.set_scale(0.0, 0.0);
        actor.show();
        
        /* scale window up from 0x0 to normal size */
        this._mapping.push(actor);
        Tweener.addTween(actor,
                         { scale_x: 1.0,
                           scale_y: 1.0,
                           time: WINDOW_ANIMATION_TIME,
                           transition: "easeOutQuad",
                           onComplete: this._mapWindowDone,
                           onCompleteScope: this,
                           onCompleteParams: [shellwm, actor],
                           onOverwrite: this._mapWindowOverwrite,
                           onOverwriteScope: this,
                           onOverwriteParams: [shellwm, actor]
                         });
    },

    _mapWindowDone : function(shellwm, actor) {
        if (this._removeEffect(this._mapping, actor)) {
            Tweener.removeTweens(actor);
            actor.set_scale(1.0, 1.0);
            actor.move_anchor_point_from_gravity(Clutter.Gravity.NORTH_WEST);
            shellwm.completed_map(actor);
        }
    },

    _mapWindowOverwrite : function(shellwm, actor) {
        if (this._removeEffect(this._mapping, actor)) {
            shellwm.completed_map(actor);
        }
    },

    _destroyWindow : function(shellwm, actor) {
        shellwm.completed_destroy(actor);
    },
    
    _destroyWindowDone : function(shellwm, actor) {
    },

    _switchWorkspace : function(shellwm, from, to, direction) {
        if (!this._shouldAnimate()) {
            shellwm.completed_switch_workspace();
            return;
        }

        let windows = shellwm.get_switch_workspace_actors();

        /* @direction is the direction that the "camera" moves, so the
         * screen contents have to move one screen's worth in the
         * opposite direction.
         */
        let xDest = 0, yDest = 0;

        if (direction == Meta.MotionDirection.UP ||
            direction == Meta.MotionDirection.UP_LEFT ||
            direction == Meta.MotionDirection.UP_RIGHT)
                yDest = global.screen_height;
        else if (direction == Meta.MotionDirection.DOWN ||
            direction == Meta.MotionDirection.DOWN_LEFT ||
            direction == Meta.MotionDirection.DOWN_RIGHT)
                yDest = -global.screen_height;

        if (direction == Meta.MotionDirection.LEFT ||
            direction == Meta.MotionDirection.UP_LEFT ||
            direction == Meta.MotionDirection.DOWN_LEFT)
                xDest = global.screen_width;
        else if (direction == Meta.MotionDirection.RIGHT ||
                 direction == Meta.MotionDirection.UP_RIGHT ||
                 direction == Meta.MotionDirection.DOWN_RIGHT)
                xDest = -global.screen_width;

        let switchData = {};
        this._switchData = switchData;
        switchData.inGroup = new Clutter.Group();
        switchData.outGroup = new Clutter.Group();
        switchData.windows = [];

        let wgroup = global.window_group;
        wgroup.add_actor(switchData.inGroup);
        wgroup.add_actor(switchData.outGroup);

        for (let i = 0; i < windows.length; i++) {
            let window = windows[i];

            if (!window.meta_window.showing_on_its_workspace())
                continue;

            if (window.get_workspace() == from) {
                switchData.windows.push({ window: window,
                                          parent: window.get_parent() });
                window.reparent(switchData.outGroup);
            } else if (window.get_workspace() == to) {
                switchData.windows.push({ window: window,
                                          parent: window.get_parent() });
                window.reparent(switchData.inGroup);
                window.show_all();
            }
        }

        switchData.inGroup.set_position(-xDest, -yDest);
        switchData.inGroup.raise_top();

        Tweener.addTween(switchData.outGroup,
                         { x: xDest,
                           y: yDest,
                           time: WINDOW_ANIMATION_TIME,
                           transition: "easeOutQuad",
                           onComplete: this._switchWorkspaceDone,
                           onCompleteScope: this,
                           onCompleteParams: [shellwm]
                         });
        Tweener.addTween(switchData.inGroup,
                         { x: 0,
                           y: 0,
                           time: WINDOW_ANIMATION_TIME,
                           transition: "easeOutQuad"
                         });
    },

    _switchWorkspaceDone : function(shellwm) {
        let switchData = this._switchData;
        if (!switchData)
            return;
        this._switchData = null;

        for (let i = 0; i < switchData.windows.length; i++) {
                let w = switchData.windows[i];
                if (w.window.get_parent() == switchData.outGroup) {
                    w.window.reparent(w.parent);
                    w.window.hide();
                } else
                    w.window.reparent(w.parent);
        }
        Tweener.removeTweens(switchData.inGroup);
        Tweener.removeTweens(switchData.outGroup);
        switchData.inGroup.destroy();
        switchData.outGroup.destroy();

        shellwm.completed_switch_workspace();
    },

    _startAppSwitcher : function(shellwm, binding, window, backwards) {
        /* prevent a corner case where both popups show up at once */
        if (this._workspaceSwitcherPopup != null)
            this._workspaceSwitcherPopup.actor.hide();

        let tabPopup = new AltTab.AltTabPopup();

        if (!tabPopup.show(backwards))
            tabPopup.destroy();
    },

    _showWorkspaceSwitcher : function(shellwm, binding, window, backwards) {
        /* We don't support this kind of layout */
        if (binding == "switch_to_workspace_up" || binding == "switch_to_workspace_down")
            return;

        if (global.screen.n_workspaces == 1)
            return;

        if (this._workspaceSwitcherPopup == null)
            this._workspaceSwitcherPopup = new WorkspaceSwitcherPopup.WorkspaceSwitcherPopup();

        if (binding == "switch_to_workspace_left") {
            this.actionMoveWorkspaceLeft();
        }

        if (binding == "switch_to_workspace_right") {
            this.actionMoveWorkspaceRight();
        }
    },

    actionMoveWorkspaceLeft: function() {
        let activeWorkspaceIndex = global.screen.get_active_workspace_index();
        if (activeWorkspaceIndex > 0) {
            global.screen.get_workspace_by_index(activeWorkspaceIndex - 1).activate(global.get_current_time());
            if (!Main.overview.visible)
                this._workspaceSwitcherPopup.display(WorkspaceSwitcherPopup.LEFT, activeWorkspaceIndex - 1);
        } else if (!Main.overview.visible) {
            this._workspaceSwitcherPopup.display(WorkspaceSwitcherPopup.LEFT, activeWorkspaceIndex);
        }
    },

    actionMoveWorkspaceRight: function() {
        let activeWorkspaceIndex = global.screen.get_active_workspace_index();
        if (activeWorkspaceIndex <  global.screen.n_workspaces - 1) {
            global.screen.get_workspace_by_index(activeWorkspaceIndex + 1).activate(global.get_current_time());
            if (!Main.overview.visible)
                this._workspaceSwitcherPopup.display(WorkspaceSwitcherPopup.RIGHT, activeWorkspaceIndex + 1);
        } else if (!Main.overview.visible) {
            this._workspaceSwitcherPopup.display(WorkspaceSwitcherPopup.RIGHT, activeWorkspaceIndex);
        }
    }
};
