/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

const Clutter = imports.gi.Clutter;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;

const Main = imports.ui.main;
const Params = imports.misc.params;

// This manages the shell "chrome"; the UI that's visible in the
// normal mode (ie, outside the Overview), that surrounds the main
// workspace content.

const defaultParams = {
    visibleInOverview: false,
    affectsStruts: true,
    affectsInputRegion: true
};

function Chrome() {
    this._init();
}

Chrome.prototype = {
    _init: function() {
        // The group itself has zero size so it doesn't interfere with DND
        this.actor = new Shell.GenericContainer({ width: 0, height: 0 });
        global.stage.add_actor(this.actor);
        this.actor.connect('allocate', Lang.bind(this, this._allocated));

        this._obscuredByFullscreen = false;

        this._trackedActors = [];

        global.screen.connect('restacked',
                              Lang.bind(this, this._windowsRestacked));

        // Need to update struts on new workspaces when they are added
        global.screen.connect('notify::n-workspaces',
                              Lang.bind(this, this._queueUpdateRegions));

        Main.overview.connect('showing',
                             Lang.bind(this, this._overviewShowing));
        Main.overview.connect('hidden',
                             Lang.bind(this, this._overviewHidden));

        this._queueUpdateRegions();
    },

    _allocated: function(actor, box, flags) {
        let children = this.actor.get_children();
        for (let i = 0; i < children.length; i++)
            children[i].allocate_preferred_size(flags);
    },

    _verifyAncestry: function(actor, ancestor) {
        while (actor) {
            if (actor == ancestor)
                return true;
            actor = actor.get_parent();
        }
        return false;
    },

    // addActor:
    // @actor: an actor to add to the chrome layer
    // @params: (optional) additional params
    //
    // Adds @actor to the chrome layer and extends the input region
    // and window manager struts to include it. (Window manager struts
    // will only be affected if @actor is touching a screen edge.)
    // Changes in @actor's size and position will automatically result
    // in appropriate changes to the input region and struts. Changes
    // in its visibility will affect the input region, but NOT the
    // struts.
    //
    // If %visibleInOverview is %true in @params, @actor will remain
    // visible when the overview is brought up. Otherwise it will
    // automatically be hidden. If %affectsStruts or %affectsInputRegion
    // is %false, the actor will not have the indicated effect.
    addActor: function(actor, params) {
        this.actor.add_actor(actor);
        this._trackActor(actor, params);
    },

    // trackActor:
    // @actor: a descendant of the chrome to begin tracking
    // @params: parameters describing how to track @actor
    //
    // Tells the chrome to track @actor, which must be a descendant
    // of an actor added via addActor(). This can be used to extend the
    // struts or input region to cover specific children.
    //
    // @params can have any of the same values as in addActor(), though
    // some possibilities don't make sense (eg, trying to have a
    // %visibleInOverview child of a non-%visibleInOverview parent).
    // By default, @actor has the same params as its chrome ancestor.
    trackActor: function(actor, params) {
        let ancestor = actor.get_parent();
        let index = this._findActor(ancestor);
        while (ancestor && index == -1) {
            ancestor = ancestor.get_parent();
            index = this._findActor(ancestor);
        }
        if (!ancestor)
            throw new Error('actor is not a descendent of the chrome layer');

        let ancestorData = this._trackedActors[index];
        if (!params)
            params = {};
        // We can't use Params.parse here because we want to drop
        // the extra values like ancestorData.actor
        for (let prop in defaultParams) {
            if (!params[prop])
                params[prop] = ancestorData[prop];
        }

        this._trackActor(actor, params);
    },

    // untrackActor:
    // @actor: an actor previously tracked via trackActor()
    //
    // Undoes the effect of trackActor()
    untrackActor: function(actor) {
        this._untrackActor(actor);
    },

    // removeActor:
    // @actor: a child of the chrome layer
    //
    // Removes @actor from the chrome layer
    removeActor: function(actor) {
        this.actor.remove_actor(actor);
        this._untrackActor(actor);
    },

    _findActor: function(actor) {
        for (let i = 0; i < this._trackedActors.length; i++) {
            let actorData = this._trackedActors[i];
            if (actorData.actor == actor)
                return i;
        }
        return -1;
    },

    _trackActor: function(actor, params) {
        if (this._findActor(actor) != -1)
            throw new Error('trying to re-track existing chrome actor');

        let actorData = Params.parse(params, defaultParams);
        actorData.actor = actor;
        actorData.visibleId = actor.connect('notify::visible',
                                            Lang.bind(this, this._queueUpdateRegions));
        actorData.allocationId = actor.connect('notify::allocation',
                                               Lang.bind(this, this._queueUpdateRegions));
        actorData.parentSetId = actor.connect('parent-set',
                                              Lang.bind(this, this._actorReparented));
        // Note that destroying actor will unset its parent, so we don't
        // need to connect to 'destroy' too.

        this._trackedActors.push(actorData);
        this._queueUpdateRegions();
    },

    _untrackActor: function(actor) {
        let i = this._findActor(actor);

        if (i == -1)
            return;
        let actorData = this._trackedActors[i];

        this._trackedActors.splice(i, 1);
        actor.disconnect(actorData.visibleId);
        actor.disconnect(actorData.allocationId);
        actor.disconnect(actorData.parentSetId);

        this._queueUpdateRegions();
    },

    _actorReparented: function(actor, oldParent) {
        if (!this._verifyAncestry(actor, this.actor))
            this._untrackActor(actor);
    },

    _overviewShowing: function() {
        this.actor.show();
        for (let i = 0; i < this._trackedActors.length; i++) {
            if (!this._trackedActors[i].visibleInOverview)
                this.actor.set_skip_paint(this._trackedActors[i].actor, true);
        }
        this._queueUpdateRegions();
    },

    _overviewHidden: function() {
        if (this._obscuredByFullscreen)
            this.actor.hide();
        for (let i = 0; i < this._trackedActors.length; i++)
            this.actor.set_skip_paint(this._trackedActors[i].actor, false);
        this._queueUpdateRegions();
    },

    _queueUpdateRegions: function() {
        if (!this._updateRegionIdle)
            this._updateRegionIdle = Mainloop.idle_add(Lang.bind(this, this._updateRegions),
                                                       Meta.PRIORITY_BEFORE_REDRAW);
    },

    _windowsRestacked: function() {
        let windows = global.get_windows();
        let primary = global.get_primary_monitor();

        // The chrome layer should be visible unless there is a window
        // with layer FULLSCREEN, or a window with layer
        // OVERRIDE_REDIRECT that covers the whole screen.
        // ("override_redirect" is not actually a layer above all
        // other windows, but this seems to be how mutter treats it
        // currently...) If we wanted to be extra clever, we could
        // figure out when an OVERRIDE_REDIRECT window was trying to
        // partially overlap us, and then adjust the input region and
        // our clip region accordingly...

        // @windows is sorted bottom to top.

        this._obscuredByFullscreen = false;
        for (let i = windows.length - 1; i > -1; i--) {
            let layer = windows[i].get_meta_window().get_layer();

            // There are 3 cases we check here for:
            // 1.) Monitor sized window
            // 2.) Window with a position somewhere on the primary screen having the _NET_WM_FULLSCREEN flag set
            // 3.) Window that is partly off screen (tries to hide its decorations) which might have negative coords
            // We check for 1.) and 2.) by checking if the upper right corner is on the primary monitor, but avoid the case
            // where it overlaps with the secondary screen (like window.x + window.width == primary.x + primary.width)
            // For 3.) we just ignore negative values as they don't really make sense

            if (layer == Meta.StackLayer.FULLSCREEN) {
                if (Math.max(windows[i].x, 0) >= primary.x && Math.max(windows[i].x, 0) < primary.x + primary.width &&
                    Math.max(windows[i].y, 0) >= primary.y && Math.max(windows[i].y, 0) < primary.y + primary.height) {
                        this._obscuredByFullscreen = true;
                        break;
                }
            }
            if (layer == Meta.StackLayer.OVERRIDE_REDIRECT) {
                if (windows[i].x <= primary.x &&
                    windows[i].x + windows[i].width >= primary.x + primary.width &&
                    windows[i].y <= primary.y &&
                    windows[i].y + windows[i].height >= primary.y + primary.height) {
                    this._obscuredByFullscreen = true;
                    break;
                }
            } else
                break;
        }

        let shouldBeVisible = !this._obscuredByFullscreen || Main.overview.visible;
        if (this.actor.visible != shouldBeVisible) {
            this.actor.visible = shouldBeVisible;
            this._queueUpdateRegions();
        }
    },

    _updateRegions: function() {
        let rects = [], struts = [], i;

        delete this._updateRegionIdle;

        for (i = 0; i < this._trackedActors.length; i++) {
            let actorData = this._trackedActors[i];
            if (!actorData.affectsInputRegion && !actorData.affectsStruts)
                continue;

            let [x, y] = actorData.actor.get_transformed_position();
            let [w, h] = actorData.actor.get_transformed_size();
            x = Math.round(x);
            y = Math.round(y);
            w = Math.round(w);
            h = Math.round(h);
            let rect = new Meta.Rectangle({ x: x, y: y, width: w, height: h});

            if (actorData.affectsInputRegion &&
                actorData.actor.get_paint_visibility() &&
                !this.actor.get_skip_paint(actorData.actor))
                rects.push(rect);

            if (!actorData.affectsStruts)
                continue;

            // Metacity wants to know what side of the screen the
            // strut is considered to be attached to. If the actor is
            // only touching one edge, or is touching the entire
            // width/height of one edge, then it's obvious which side
            // to call it. If it's in a corner, we pick a side
            // arbitrarily. If it doesn't touch any edges, or it spans
            // the width/height across the middle of the screen, then
            // we don't create a strut for it at all.
            let side;
            if (w >= global.screen_width) {
                if (y <= 0)
                    side = Meta.Side.TOP;
                else if (y + h >= global.screen_height)
                    side = Meta.Side.BOTTOM;
                else
                    continue;
            } else if (h >= global.screen_height) {
                if (x <= 0)
                    side = Meta.Side.LEFT;
                else if (x + w >= global.screen_width)
                    side = Meta.Side.RIGHT;
                else
                    continue;
            } else if (x <= 0)
                side = Meta.Side.LEFT;
            else if (y <= 0)
                side = Meta.Side.TOP;
            else if (x + w >= global.screen_width)
                side = Meta.Side.RIGHT;
            else if (y + h >= global.screen_height)
                side = Meta.Side.BOTTOM;
            else
                continue;

            let strut = new Meta.Strut({ rect: rect, side: side });
            struts.push(strut);
        }

        global.set_stage_input_region(rects);

        let screen = global.screen;
        for (let w = 0; w < screen.n_workspaces; w++) {
            let workspace = screen.get_workspace_by_index(w);
            workspace.set_builtin_struts(struts);
        }

        return false;
    }
};
