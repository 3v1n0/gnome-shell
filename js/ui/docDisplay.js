/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

const Big = imports.gi.Big;
const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;
const Lang = imports.lang;
const Pango = imports.gi.Pango;
const Shell = imports.gi.Shell;
const Signals = imports.signals;
const Mainloop = imports.mainloop;

const DocInfo = imports.misc.docInfo;
const DND = imports.ui.dnd;
const GenericDisplay = imports.ui.genericDisplay;
const Main = imports.ui.main;

const DASH_DOCS_ICON_SIZE = 16;

const DEFAULT_SPACING = 4;

/* This class represents a single display item containing information about a document.
 * We take the current number of seconds in the constructor to avoid looking up the current
 * time for every item when they are created in a batch.
 *
 * docInfo - DocInfo object containing information about the document
 * currentSeconds - current number of seconds since the epoch
 */
function DocDisplayItem(docInfo, currentSecs) {
    this._init(docInfo, currentSecs);
}

DocDisplayItem.prototype = {
    __proto__:  GenericDisplay.GenericDisplayItem.prototype,

    _init : function(docInfo, currentSecs) {
        GenericDisplay.GenericDisplayItem.prototype._init.call(this);
        this._docInfo = docInfo;

        this._setItemInfo(docInfo.name, "");

        this._timeoutTime = -1;
        this._resetTimeDisplay(currentSecs);
    },

    //// Public methods ////

    getUpdateTimeoutTime: function() {
        return this._timeoutTime;
    },

    // Update any relative-time based displays for this item.
    redisplay: function(currentSecs) {
        this._resetTimeDisplay(currentSecs);
    },

    //// Public method overrides ////

    // Opens a document represented by this display item.
    launch : function() {
        this._docInfo.launch();
    },

    //// Protected method overrides ////

    // Returns an icon for the item.
    _createIcon : function() {
        return this._docInfo.createIcon(GenericDisplay.ITEM_DISPLAY_ICON_SIZE);
    },

    // Returns a preview icon for the item.
    _createPreviewIcon : function() {
        return this._docInfo.createIcon(GenericDisplay.PREVIEW_ICON_SIZE);
    },

    // Creates and returns a large preview icon, but only if this._docInfo is an image file
    // and we were able to generate a pixbuf from it successfully.
    _createLargePreviewIcon : function() {
        if (this._docInfo.mimeType == null || this._docInfo.mimeType.indexOf("image/") != 0)
            return null;

        try {
            return Shell.TextureCache.get_default().load_uri_sync(Shell.TextureCachePolicy.NONE,
                                                                  this._docInfo.uri, -1, -1);
        } catch (e) {
            // An exception will be raised when the image format isn't know
            /* FIXME: http://bugzilla.gnome.org/show_bug.cgi?id=591480: should
             *        only ignore GDK_PIXBUF_ERROR_UNKNOWN_TYPE. */
            return null;
        }
    },

    //// Drag and Drop ////

    shellWorkspaceLaunch: function() {
        this.launch();
    },

    //// Private Methods ////

    // Updates the last visited time displayed in the description text for the item.
    _resetTimeDisplay: function(currentSecs) {
        let lastSecs = this._docInfo.timestamp;
        let timeDelta = currentSecs - lastSecs;
        let [text, nextUpdate] = global.format_time_relative_pretty(timeDelta);
        this._timeoutTime = currentSecs + nextUpdate;
        this._setDescriptionText(text);
    }
};

/* This class represents a display containing a collection of document items.
 * The documents are sorted by how recently they were last visited.
 */
function DocDisplay() {
    this._init();
}

DocDisplay.prototype = {
    __proto__:  GenericDisplay.GenericDisplay.prototype,

    _init : function() {
        GenericDisplay.GenericDisplay.prototype._init.call(this);
        // We keep a single timeout callback for updating last visited times
        // for all the items in the display. This avoids creating individual
        // callbacks for each item in the display. So proper time updates
        // for individual items and item details depend on the item being 
        // associated with one of the displays.
        this._updateTimeoutTargetTime = -1;
        this._updateTimeoutId = 0;

        this._docManager = DocInfo.getDocManager();
        this._docsStale = true;
        this._docManager.connect('changed', Lang.bind(this, function(mgr, userData) {
            this._docsStale = true;
            // Changes in local recent files should not happen when we are in the Overview mode,
            // but redisplaying right away is cool when we use Zephyr.
            // Also, we might be displaying remote documents, like Google Docs, in the future
            // which might be edited by someone else.
            this._redisplay(false);
        }));

        this.connect('destroy', Lang.bind(this, function (o) {
            if (this._updateTimeoutId > 0)
                Mainloop.source_remove(this._updateTimeoutId);
        }));
    },

    //// Protected method overrides ////

    // Gets the list of recent items from the recent items manager.
    _refreshCache : function() {
        if (!this._docsStale)
            return;
        this._allItems = this._docManager.getItems();
        this._docsStale = false;
    },

    // Sets the list of the displayed items based on how recently they were last visited.
    _setDefaultList : function() {
        // It seems to be an implementation detail of the Mozilla JavaScript that object
        // properties are returned during the iteration in the same order in which they were
        // defined, but it is not a guarantee according to this 
        // https://developer.mozilla.org/en/Core_JavaScript_1.5_Reference/Statements/for...in
        // While this._allItems associative array seems to always be ordered by last added,
        // as the results of this._recentManager.get_items() based on which it is constructed are,
        // we should do the sorting manually because we want the order to be based on last visited.
        //
        // This function is called each time the search string is set back to '' or we display
        // the Overview, so we are doing the sorting over the same items multiple times if the list
        // of recent items didn't change. We could store an additional array of doc ids and sort
        // them once when they are returned by this._recentManager.get_items() to avoid having to do 
        // this sorting each time, but the sorting seems to be very fast anyway, so there is no need
        // to introduce an additional class variable.
        this._matchedItems = [];
        let docIdsToRemove = [];
        for (docId in this._allItems) {
            // this._allItems[docId].exists() checks if the resource still exists
            if (this._allItems[docId].exists()) 
                this._matchedItems.push(docId);
            else 
                docIdsToRemove.push(docId);
        }

        for (docId in docIdsToRemove) {
            delete this._allItems[docId];
        }

        this._matchedItems.sort(Lang.bind(this, function (a,b) { return this._compareItems(a,b); }));
    },

    // Compares items associated with the item ids based on how recently the items
    // were last visited.
    // Returns an integer value indicating the result of the comparison.
   _compareItems : function(itemIdA, itemIdB) {
        let docA = this._allItems[itemIdA];
        let docB = this._allItems[itemIdB];

        return docB.timestamp - docA.timestamp;
    },

    // Checks if the item info can be a match for the search string by checking
    // the name of the document. Item info is expected to be GtkRecentInfo.
    // Returns a boolean flag indicating if itemInfo is a match.
    _isInfoMatching : function(itemInfo, search) {
        if (!itemInfo.exists())
            return false;
 
        if (search == null || search == '')
            return true;

        let name = itemInfo.name.toLowerCase();
        if (name.indexOf(search) >= 0)
            return true;
        // TODO: we can also check doc URIs, so that
        // if you search for a directory name, we display recent files from it
        return false;
    },

    // Creates a DocDisplayItem based on itemInfo, which is expected to be a DocInfo object.
    _createDisplayItem: function(itemInfo) {
        let currentSecs = new Date().getTime() / 1000;
        let docDisplayItem = new DocDisplayItem(itemInfo, currentSecs);
        this._updateTimeoutCallback(docDisplayItem, currentSecs);
        return docDisplayItem;
    },

    //// Private Methods ////

    // A callback function that redisplays the items, updating their descriptions,
    // and sets up a new timeout callback.
    _docTimeout: function () {
        let currentSecs = new Date().getTime() / 1000;
        this._updateTimeoutId = 0;
        this._updateTimeoutTargetTime = -1;
        for (let docId in this._displayedItems) {
            let docDisplayItem = this._displayedItems[docId];
            docDisplayItem.redisplay(currentSecs);          
            this._updateTimeoutCallback(docDisplayItem, currentSecs);
        }
        return false;
    },

    // Updates the timeout callback if the timeout time for the docDisplayItem 
    // is earlier than the target time for the current timeout callback.
    _updateTimeoutCallback: function (docDisplayItem, currentSecs) {
        let timeoutTime = docDisplayItem.getUpdateTimeoutTime();
        if (this._updateTimeoutTargetTime < 0 || timeoutTime < this._updateTimeoutTargetTime) {
            if (this._updateTimeoutId > 0)
                Mainloop.source_remove(this._updateTimeoutId);
            this._updateTimeoutId = Mainloop.timeout_add_seconds(timeoutTime - currentSecs, Lang.bind(this, this._docTimeout));
            this._updateTimeoutTargetTime = timeoutTime;
        }
    }
};

Signals.addSignalMethods(DocDisplay.prototype);

function DashDocDisplayItem(docInfo) {
    this._init(docInfo);
}

DashDocDisplayItem.prototype = {
    _init: function(docInfo) {
        this._info = docInfo;
        this.actor = new Big.Box({ orientation: Big.BoxOrientation.HORIZONTAL,
                                   spacing: DEFAULT_SPACING,
                                   reactive: true });
        this.actor.connect('button-release-event', Lang.bind(this, function () {
            docInfo.launch();
            Main.overview.hide();
        }));

        this._icon = docInfo.createIcon(DASH_DOCS_ICON_SIZE);
        let iconBox = new Big.Box({ y_align: Big.BoxAlignment.CENTER });
        iconBox.append(this._icon, Big.BoxPackFlags.NONE);
        this.actor.append(iconBox, Big.BoxPackFlags.NONE);
        let name = new Clutter.Text({ font_name: "Sans 14px",
                                      color: GenericDisplay.ITEM_DISPLAY_NAME_COLOR,
                                      ellipsize: Pango.EllipsizeMode.END,
                                      text: docInfo.name });
        this.actor.append(name, Big.BoxPackFlags.EXPAND);

        let draggable = DND.makeDraggable(this.actor);
        this.actor._delegate = this;
    },

    getDragActorSource: function() {
        return this._icon;
    },

    getDragActor: function(stageX, stageY) {
        this.dragActor = this._info.createIcon(DASH_DOCS_ICON_SIZE);
        return this.dragActor;
    },

    //// Drag and drop functions ////

    shellWorkspaceLaunch: function () {
        this._info.launch();
    }
}

/**
 * Class used to display two column recent documents in the dash
 */
function DashDocDisplay() {
    this._init();
}

DashDocDisplay.prototype = {
    _init: function() {
        this.actor = new Shell.GenericContainer();
        this.actor.connect('get-preferred-width', Lang.bind(this, this._getPreferredWidth));
        this.actor.connect('get-preferred-height', Lang.bind(this, this._getPreferredHeight));
        this.actor.connect('allocate', Lang.bind(this, this._allocate));

        this._docManager = DocInfo.getDocManager();
        this._docManager.connect('changed', Lang.bind(this, function(mgr) {
            this._redisplay();
        }));
        this._redisplay();
    },

    _getPreferredWidth: function(actor, forHeight, alloc) {
        let children = actor.get_children();

        // We use two columns maximum.  Just take the min and natural size of the
        // first two items, even though strictly speaking it's not correct; we'd
        // need to calculate how many items we could fit for the height, then
        // take the biggest preferred width for each column.
        // In practice the dash gets a fixed width anyways.

        // If we have one child, add its minimum and natural size
        if (children.length > 0) {
            let [minSize, naturalSize] = children[0].get_preferred_width(forHeight);
            alloc.min_size += minSize;
            alloc.natural_size += naturalSize;
        }
        // If we have two, add its size, plus DEFAULT_SPACING
        if (children.length > 1) {
            let [minSize, naturalSize] = children[1].get_preferred_width(forHeight);
            alloc.min_size += DEFAULT_SPACING + minSize;
            alloc.natural_size += DEFAULT_SPACING + naturalSize;
        }
    },

    _getPreferredHeight: function(actor, forWidth, alloc) {
        let children = actor.get_children();

        // Two columns, where we go vertically down first.  So just take
        // the height of half of the children as our preferred height.

        let firstColumnChildren = children.length / 2;

        alloc.min_size = 0;
        for (let i = 0; i < firstColumnChildren; i++) {
            let child = children[i];
            let [minSize, naturalSize] = child.get_preferred_height(forWidth);
            alloc.natural_size += naturalSize;

            if (i > 0 && i < children.length - 1) {
                alloc.min_size += DEFAULT_SPACING;
                alloc.natural_size += DEFAULT_SPACING;
            }
        }
    },

    _allocate: function(actor, box, flags) {
        let width = box.x2 - box.x1;
        let height = box.y2 - box.y1;

        let children = actor.get_children();

        // The width of an item is our allocated width, minus spacing, divided in half.
        let itemWidth = Math.floor((width - DEFAULT_SPACING) / 2);
        let x = box.x1;
        let y = box.y1;
        let columnIndex = 0;
        let i = 0;
        // Loop over the children, going vertically down first.  When we run
        // out of vertical space (our y variable is bigger than box.y2), switch
        // to the second column.
        for (; i < children.length; i++) {
            let child = children[i];

            let [minSize, naturalSize] = child.get_preferred_height(-1);

            if (y + naturalSize > box.y2) {
                // Is this the second column?  Ok, break.
                if (columnIndex == 1) {
                    break;
                }
                // Set x to the halfway point.
                columnIndex += 1;
                x = x + itemWidth + DEFAULT_SPACING;
                // And y is back to the top.
                y = box.y1;
            }

            let childBox = new Clutter.ActorBox();
            childBox.x1 = x;
            childBox.y1 = y;
            childBox.x2 = childBox.x1 + itemWidth;
            childBox.y2 = y + naturalSize;

            y = childBox.y2 + DEFAULT_SPACING;

            child.show();
            child.allocate(childBox, flags);
        }

        // Everything else didn't fit, just hide it.
        for (; i < children.length; i++) {
            children[i].hide();
        }
    },

    _redisplay: function() {
        this.actor.remove_all();

        let docs = this._docManager.getItems();
        let docUrls = [];
        for (let url in docs) {
            docUrls.push(url);
        }
        docUrls.sort(function (urlA, urlB) { return docs[urlB].timestamp - docs[urlA].timestamp; });
        let textureCache = Shell.TextureCache.get_default();

        for (let i = 0; i < docUrls.length; i++) {
            let url = docUrls[i];
            let docInfo = docs[url];
            let display = new DashDocDisplayItem(docInfo);
            this.actor.add_actor(display.actor);
        }
    }
}
