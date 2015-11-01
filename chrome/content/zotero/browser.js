/**
 * This file is adapted from Zotero. Some parts that are of no
 * use to Dontprint were left out. Dontprint loads this file
 * only if Zotero is not installed. If Zotero is installed,
 * Dontprint hooks directly into Zotero's internals.
 */


/*
    ***** BEGIN LICENSE BLOCK *****
    
    Copyright © 2009 Center for History and New Media
                     George Mason University, Fairfax, Virginia, USA
                     http://zotero.org
    
    This file is part of Zotero.
    
    Zotero is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.
    
    Zotero is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.
    
    You should have received a copy of the GNU Affero General Public License
    along with Zotero.  If not, see <http://www.gnu.org/licenses/>.
    
    
    Based on code from Greasemonkey and PiggyBank
    
    ***** END LICENSE BLOCK *****
*/

//
// Zotero Ingester Browser Functions
//

//////////////////////////////////////////////////////////////////////////////
//
// Zotero_Browser
//
//////////////////////////////////////////////////////////////////////////////

// Class to interface with the browser when ingesting data

var Zotero_Browser = new function() {
	this.init = init;
	this.chromeLoad = chromeLoad;
	this.contentLoad = contentLoad;
	this.itemUpdated = itemUpdated;
	this.contentHide = contentHide;
	this.tabClose = tabClose;
	this.updateStatus = updateStatus;
	this.initialized = false;
	
	this.tabbrowser = null;
	this.appcontent = null;
	this.isScraping = false;
	
	var _browserData = new WeakMap();
	var _attachmentsMap = new WeakMap();
	
	var _blacklist = [
		"googlesyndication.com",
		"doubleclick.net",
		"questionmarket.com",
		"atdmt.com",
		"aggregateknowledge.com",
		"ad.yieldmanager.com"
	];
	
	var _locationBlacklist = [
		"zotero://debug/"
	];
	
	//////////////////////////////////////////////////////////////////////////////
	//
	// Public Zotero_Browser methods
	//
	//////////////////////////////////////////////////////////////////////////////
	
	
	/**
	 * Initialize some variables and prepare event listeners for when chrome is done loading
	 */
	function init() {
		if (this.initialized || !Zotero || !Zotero.initialized || !window.hasOwnProperty("gBrowser")) {
			return;
		}
		this.initialized = true;
		this.chromeLoad();
	}
	
	/*
	 * When chrome loads, register our event handlers with the appropriate interfaces
	 */
	function chromeLoad() {
		this.tabbrowser = gBrowser;
		this.appcontent = document.getElementById("appcontent");
		
		// this gives us onLocationChange, for updating when tabs are switched/created
		gBrowser.tabContainer.addEventListener("TabClose",
			function(e) {
				//Zotero.debug("TabClose");
				Zotero_Browser.tabClose(e);
			}, false);
		gBrowser.tabContainer.addEventListener("TabSelect",
			function(e) {
				//Zotero.debug("TabSelect");
				Zotero_Browser.updateStatus();
			}, false);
		// this is for pageshow, for updating the status of the book icon
		this.appcontent.addEventListener("pageshow", contentLoad, true);
		// this is for turning off the book icon when a user navigates away from a page
		this.appcontent.addEventListener("pagehide",
			function(e) {
				//Zotero.debug("pagehide");
				Zotero_Browser.contentHide(e);
			}, true);
	}
	
	
	/*
	 * An event handler called when a new document is loaded. Creates a new document
	 * object, and updates the status of the capture icon
	 */
	function contentLoad(event) {
		var doc = event.originalTarget;
		var isHTML = doc instanceof HTMLDocument;
		var rootDoc = (doc instanceof HTMLDocument ? doc.defaultView.top.document : doc);
		var browser = Zotero_Browser.tabbrowser.getBrowserForDocument(rootDoc);
		if(!browser) return;
		
		if(isHTML) {
			// ignore blacklisted domains
			try {
				if(doc.domain) {
					for (let i = 0; i < _blacklist.length; i++) {
						let blacklistedURL = _blacklist[i];
						if(doc.domain.substr(doc.domain.length-blacklistedURL.length) == blacklistedURL) {
							Zotero.debug("Ignoring blacklisted URL "+doc.location);
							return;
						}
					}
				}
			}
			catch (e) {}
		}
		
		try {
			if (_locationBlacklist.indexOf(doc.location.href) != -1) {
				return;
			}
			
			// Ignore TinyMCE popups
			if (!doc.location.host && doc.location.href.indexOf("tinymce/") != -1) {
				return;
			}
		}
		catch (e) {}
		
		// get data object
		var tab = _getTabObject(browser);
		
		// detect translators
		tab.detectTranslators(rootDoc, doc);
		
		// register metadata updated event
		if(isHTML) {
			var contentWin = doc.defaultView;
			if(!contentWin.haveZoteroEventListener) {
				contentWin.addEventListener("ZoteroItemUpdated", function(event) { itemUpdated(event.originalTarget) }, false);
				contentWin.haveZoteroEventListener = true;
			}
		}
	}

	/*
	 * called to unregister Zotero icon, etc.
	 */
	function contentHide(event) {
		var doc = event.originalTarget;
		if(!(doc instanceof HTMLDocument)) return;
	
		var rootDoc = (doc instanceof HTMLDocument ? doc.defaultView.top.document : doc);
		var browser = Zotero_Browser.tabbrowser.getBrowserForDocument(rootDoc);
		if(!browser) return;
		
		var tab = _getTabObject(browser);
		if(!tab) return;

		var page = tab.getPageObject();
		if(!page) return;

		if(doc == page.document || doc == rootDoc) {
			// clear translator only if the page on which the pagehide event was called is
			// either the page to which the translator corresponded, or the root document
			// (the second check is probably paranoid, but won't hurt)
			tab.clear();
		}
		
		// update status
		if(Zotero_Browser.tabbrowser.selectedBrowser == browser) {
			updateStatus();
		}
	}
	
	/**
	 * Called when item should be updated due to a DOM event
	 */
	function itemUpdated(doc) {
		try {
			var rootDoc = (doc instanceof HTMLDocument ? doc.defaultView.top.document : doc);
			var browser = Zotero_Browser.tabbrowser.getBrowserForDocument(rootDoc);
			var tab = _getTabObject(browser);
			if(doc == tab.getPageObject().document || doc == rootDoc) tab.clear();
			tab.detectTranslators(rootDoc, doc);
		} catch(e) {
			Zotero.debug(e);
		}
	}
	
	/*
	 * called when a tab is closed
	 */
	function tabClose(event) {
		var tab = _getTabObject(event.target);
		var page = tab.getPageObject();
		tab.clear();
	}
	
	
	/*
	 * Notifies Dontprint to update the Dontprint icon in the url bar.
	 * Set Zotero_Browser.updateStatusCallback to a function that should
	 * be called if the state of the Dontprint icon changes.
	 * TODO: might be obsolete
	 */
	function updateStatus() {
		if (this.updateStatusCallback) {
			this.updateStatusCallback();
		}
	}
	
	/**
	 * Translates using the specified translation instance. setTranslator() must already
	 * have been called
	 * @param {Zotero.Translate} translate
	 */
	this.performTranslation = function(translate, libraryID, collection) {
		if (Zotero.locked) {
			Zotero_Browser.progress.changeHeadline(Zotero.getString("ingester.scrapeError"));
			var desc = Zotero.localeJoin([
				Zotero.getString('general.operationInProgress'),
				Zotero.getString('general.operationInProgress.waitUntilFinishedAndTryAgain')
			]);
			Zotero_Browser.progress.addDescription(desc);
			Zotero_Browser.progress.show();
			Zotero_Browser.progress.startCloseTimer(8000);
			return;
		}
		
		if (!Zotero.stateCheck()) {
			Zotero_Browser.progress.changeHeadline(Zotero.getString("ingester.scrapeError"));
			var desc = Zotero.getString("ingester.scrapeErrorDescription.previousError")
				+ ' ' + Zotero.getString("general.restartFirefoxAndTryAgain", Zotero.appName);
			Zotero_Browser.progress.addDescription(desc);
			Zotero_Browser.progress.show();
			Zotero_Browser.progress.startCloseTimer(8000);
			return;
		}
		
		Zotero_Browser.progress.show();
		Zotero_Browser.isScraping = true;
		
		// Get libraryID and collectionID
		if(libraryID === undefined && ZoteroPane && !Zotero.isConnector) {
			try {
				if (!ZoteroPane.collectionsView.editable) {
					Zotero_Browser.progress.changeHeadline(Zotero.getString("ingester.scrapeError"));
					var desc = Zotero.getString('save.error.cannotMakeChangesToCollection');
					Zotero_Browser.progress.addDescription(desc);
					Zotero_Browser.progress.show();
					Zotero_Browser.progress.startCloseTimer(8000);
					return;
				}
				
				libraryID = ZoteroPane.getSelectedLibraryID();
				collection = ZoteroPane.getSelectedCollection();
			} catch(e) {
				Zotero.debug(e, 1);
			}
		}
		
		if(Zotero.isConnector) {
			Zotero.Connector.callMethod("getSelectedCollection", {}, function(response, status) {
				if(status !== 200) {
					Zotero_Browser.progress.changeHeadline(Zotero.getString("ingester.scraping"));
				} else {
					Zotero_Browser.progress.changeHeadline(Zotero.getString("ingester.scrapingTo"),
						"chrome://zotero/skin/treesource-"+(response.id ? "collection" : "library")+".png",
						response.name+"\u2026");
				}
			});
		} else {
			var name;
			if(collection) {
				name = collection.name;
			} else if(libraryID) {
				name = Zotero.Libraries.getName(libraryID);
			} else {
				name = Zotero.getString("pane.collections.library");
			}
			
			Zotero_Browser.progress.changeHeadline(Zotero.getString("ingester.scrapingTo"),
				"chrome://zotero/skin/treesource-"+(collection ? "collection" : "library")+".png",
				name+"\u2026");
		}
		
		translate.clearHandlers("done");
		translate.clearHandlers("itemDone");
		translate.clearHandlers("attachmentProgress");
		
		translate.setHandler("done", function(obj, returnValue) {		
			if(!returnValue) {
				Zotero_Browser.progress.show();
				Zotero_Browser.progress.changeHeadline(Zotero.getString("ingester.scrapeError"));
				// Include link to translator troubleshooting page
				var url = "https://www.zotero.org/support/troubleshooting_translator_issues";
				var linkText = '<a href="' + url + '" tooltiptext="' + url + '">'
					+ Zotero.getString('ingester.scrapeErrorDescription.linkText') + '</a>';
				Zotero_Browser.progress.addDescription(Zotero.getString("ingester.scrapeErrorDescription", linkText));
				Zotero_Browser.progress.startCloseTimer(8000);
			} else {
				Zotero_Browser.progress.startCloseTimer();
			}
			Zotero_Browser.isScraping = false;
		});
		
		translate.setHandler("itemDone", function(obj, dbItem, item) {
			Zotero_Browser.progress.show();
			var itemProgress = new Zotero_Browser.progress.ItemProgress(Zotero.ItemTypes.getImageSrc(item.itemType),
				item.title);
			itemProgress.setProgress(100);
			for(var i=0; i<item.attachments.length; i++) {
				var attachment = item.attachments[i];
				_attachmentsMap.set(attachment,
					new Zotero_Browser.progress.ItemProgress(
						Zotero.Utilities.determineAttachmentIcon(attachment),
						attachment.title, itemProgress));
			}
			
			// add item to collection, if one was specified
			if(collection) {
				collection.addItem(dbItem.id);
			}
		});
		
		translate.setHandler("attachmentProgress", function(obj, attachment, progress, error) {
			var itemProgress = _attachmentsMap.get(attachment);
			if(progress === false) {
				itemProgress.setError();
			} else {
				itemProgress.setProgress(progress);
				if(progress === 100) {
					itemProgress.setIcon(Zotero.Utilities.determineAttachmentIcon(attachment));
				}
			}
		});
		
		translate.translate(libraryID);
	}
	
	
	//////////////////////////////////////////////////////////////////////////////
	//
	// Private Zotero_Browser methods
	//
	//////////////////////////////////////////////////////////////////////////////
	
	/*
	 * Gets a data object given a browser window object
	 */
	function _getTabObject(browser) {
		if(!browser) return false;
		var obj = _browserData.get(browser);
		if(!obj) {
			obj = new Zotero_Browser.Tab(browser);
			_browserData.set(browser, obj);
		}
		return obj;
	}
};


//////////////////////////////////////////////////////////////////////////////
//
// Zotero_Browser.Tab
//
//////////////////////////////////////////////////////////////////////////////

Zotero_Browser.Tab = function(browser) {
	this.browser = browser;
	this.wm = new WeakMap();
};

Zotero_Browser.Tab.prototype.CAPTURE_STATE_DISABLED = 0;
Zotero_Browser.Tab.prototype.CAPTURE_STATE_GENERIC = 1;
Zotero_Browser.Tab.prototype.CAPTURE_STATE_TRANSLATABLE = 2;

/**
 * Gets page-specific information (stored in WeakMap to prevent holding
 * a reference to translate)
 */
Zotero_Browser.Tab.prototype.getPageObject = function() {
	var doc = this.browser.contentWindow;
	if(!doc) return null;
	var obj = this.wm.get(doc);
	if(!obj) {
		obj = {};
		this.wm.set(doc, obj);
	}
	return obj;
};

/*
 * Removes page-specific information from WeakMap
 */
Zotero_Browser.Tab.prototype.clear = function() {
	this.wm.delete(this.browser.contentWindow);
};

/*
 * detects translators for this browser object
 */
Zotero_Browser.Tab.prototype.detectTranslators = function(rootDoc, doc) {
	if (doc instanceof HTMLDocument) {
		if (doc.documentURI.startsWith("about:")) {
			return;
		}
		
		// get translators
		var me = this;
		
		var translate = new Zotero.Translate.Web();
		translate.setDocument(doc);
		translate.setHandler("translators", function(obj, item) { me._translatorsAvailable(obj, item) });
		translate.setHandler("pageModified", function(translate, doc) { Zotero_Browser.itemUpdated(doc) });
		translate.getTranslators(true);
	}
};


Zotero_Browser.Tab.prototype.getCaptureState = function () {
	var page = this.getPageObject();
	if (!page.saveEnabled) {
		return this.CAPTURE_STATE_DISABLED;
	}
	if (page.translators && page.translators.length) {
		return this.CAPTURE_STATE_TRANSLATABLE;
	}
	return this.CAPTURE_STATE_GENERIC;
};

/*
 * returns the URL of the image representing the translator to be called on the
 * current page, or false if the page cannot be scraped
 */
Zotero_Browser.Tab.prototype.getCaptureIcon = function (hiDPI) {
	var suffix = hiDPI ? "@2x" : "";
	
	switch (this.getCaptureState()) {
	case this.CAPTURE_STATE_TRANSLATABLE:
		var itemType = this.getPageObject().translators[0].itemType;
		return (itemType === "multiple"
				? "chrome://zotero/skin/treesource-collection" + suffix + ".png"
				: Zotero.ItemTypes.getImageSrc(itemType));
	
	default:
		return this.getWebPageCaptureIcon(hiDPI);
	}
};

// TODO: Show icons for images, PDFs, etc.?
Zotero_Browser.Tab.prototype.getWebPageCaptureIcon = function (hiDPI) {
	var suffix = hiDPI ? "@2x" : "";
	return "chrome://zotero/skin/treeitem-webpage" + suffix + ".png";
};

Zotero_Browser.Tab.prototype.getCaptureTooltip = function() {
	switch (this.getCaptureState()) {
	case this.CAPTURE_STATE_DISABLED:
		var text = Zotero.getString('ingester.saveToZotero');
		break;
	
	case this.CAPTURE_STATE_TRANSLATABLE:
		var text = Zotero.getString('ingester.saveToZotero');
		var translator = this.getPageObject().translators[0];
		if (translator.itemType == 'multiple') {
			text += '…';
		}
		text += ' (' + translator.label + ')';
		break;
	
	// TODO: Different captions for images, PDFs, etc.?
	default:
		var text = Zotero.getString('ingester.saveToZotero')
			+ " (" + Zotero.getString('itemTypes.webpage') + ")";
	}
	
	var key = Zotero.Keys.getKeyForCommand('saveToZotero');
	if (key) {
		// Add RLE mark in RTL mode to make shortcut render the right way
		text += (Zotero.rtl ? ' \u202B' : ' ') + '('
		+ (Zotero.isMac ? '⇧⌘' : Zotero.getString('general.keys.ctrlShift'))
		+ key
		+ ')';
	}
	
	return text;
};

Zotero_Browser.Tab.prototype.getCaptureCommand = function () {
	switch (this.getCaptureState()) {
	case this.CAPTURE_STATE_DISABLED:
		return '';
	case this.CAPTURE_STATE_TRANSLATABLE:
		return '';
	default:
		return 'cmd_zotero_newItemFromCurrentPage';
	}
};


/**********CALLBACKS**********/

/*
 * called when translators are available
 */
Zotero_Browser.Tab.prototype._translatorsAvailable = function(translate, translators) {
	var page = this.getPageObject();
	page.saveEnabled = true;
	
	if(translators && translators.length) {
		//see if we should keep the previous set of translators
		if(//we already have a translator for part of this page
			page.translators && page.translators.length && page.document.location
			//and the page is still there
			&& page.document.defaultView && !page.document.defaultView.closed
			//this set of translators is not targeting the same URL as a previous set of translators,
			// because otherwise we want to use the newer set,
			// but only if it's not in a subframe of the previous set
			&& (page.document.location.href != translate.document.location.href ||
				Zotero.Utilities.Internal.isIframeOf(translate.document.defaultView, page.document.defaultView))
				//the best translator we had was of higher priority than the new set
			&& (page.translators[0].priority < translators[0].priority
				//or the priority was the same, but...
				|| (page.translators[0].priority == translators[0].priority
					//the previous set of translators targets the top frame or the current one does not either
					&& (page.document.defaultView == page.document.defaultView.top
						|| translate.document.defaultView !== page.document.defaultView.top)
			))
		) {
			Zotero.debug("Translate: a better translator was already found for this page");
			return; //keep what we had
		} else {
			this.clear(); //clear URL bar icon
			page = this.getPageObject();
			page.saveEnabled = true;
		}
		
		Zotero.debug("Translate: found translators for page\n"
			+ "Best translator: " + translators[0].label + " with priority " + translators[0].priority);
		page.translate = translate;
		page.translators = translators;
		page.document = translate.document;
	}
	
	if(!translators || !translators.length) Zotero.debug("Translate: No translators found");
	
	Zotero_Browser.updateStatus();
};

Zotero_Browser.init();