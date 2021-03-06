﻿(function () {
    "use strict";

    var internalName = "CDNManager";

    function getqueryStringValue(name) {
        try {
            var args = window.location.search.substring(1).split("&");
            var r = "";
            var argsCount = args.length;
            for (var i = 0; i < argsCount; i++) {
                var n = args[i].split("=");
                if (n[0] === name)
                    r = decodeURIComponent(n[1]);
            }
            return r;
        }
        catch (err) {
            return undefined;
        }
    }

    function getUserCustomActions() {

        var hostWebUrl = getqueryStringValue("SPHostUrl");
        var appWebUrl = getqueryStringValue("SPAppWebUrl");
        var executor = new SP.RequestExecutor(appWebUrl);
        var deferred = jQuery.Deferred();

        executor.executeAsync({
            url: "../_api/SP.AppContextSite(@target)/web/usercustomactions?$select=Id,Description&$filter=Location%20eq%20'ScriptLink'" +
                "&@target='" + hostWebUrl + "'",
            method: "GET",
            headers: { "accept": "application/json" },
            success: function (data) {
                deferred.resolve(JSON.parse(data.body));
            },
            error: function (err) {
                deferred.reject(JSON.parse(err.body)["odata.error"].message.value);
            }
        });

        return deferred.promise();
    }

    // ReSharper disable once InconsistentNaming
    function getCDNList() {
        return jQuery.ajax({
            url: "../_api/web/lists/getByTitle('CDNs')/items?$select=Id,Title,Namespace,Type,Url,Dependency,Active,Sequence&$orderby=Sequence",
            headers: { "accept": "application/json" }
        });
    }

    // ReSharper disable once InconsistentNaming
    function testCDN(cdnEntry) {
        //Use YQL to test endpoint validity
        return jQuery.ajax({
            url: "https://query.yahooapis.com/v1/public/yql?" +
                "q=select%20*%20from%20xml%20where%20url%20%3D%20'" +
                encodeURIComponent(cdnEntry.Url) +
                "'&format=json&diagnostics=true",
            dataType: 'jsonp',
            success: function (data) {
                var diagnostics = data.query.diagnostics;
                if (typeof(diagnostics.url["http-status-code"]) === 'undefined') {
                    cdnEntry.Validated(true);
                }
                else {
                    cdnEntry.Validated(false);
                }

            },
            error: function () {
                cdnEntry.Validated(false);
            }
        });
    }

    function checkScriptingPermissions() {
        var hostWebUrl = getqueryStringValue("SPHostUrl");
        var appWebUrl = getqueryStringValue("SPAppWebUrl");
        var executor = new SP.RequestExecutor(appWebUrl);
        var deferred = jQuery.Deferred();

        executor.executeAsync({
            url: "../_api/SP.AppContextSite(@target)/web/effectiveBasePermissions?" +
                "&@target='" + hostWebUrl + "'",
            method: "GET",
            headers: { "accept": "application/json" },
            success: function (data) {
                var permissions = new SP.BasePermissions();
                permissions.fromJson(JSON.parse(data.body));
                deferred.resolve(permissions.has(SP.PermissionKind.addAndCustomizePages));
            },
            error: function (err) {
                deferred.reject(JSON.parse(err.body)["odata.error"].message.value);
            }
        });

        return deferred.promise();
    }

    function cdnViewModel() {

        window.cdnEntries = ko.observableArray();
        window.allowScripting = ko.observable(undefined);
        window.validationComplete = ko.observable(false);

        checkScriptingPermissions().then(
            function (data) {
                window.allowScripting(data);
            },
            function () {
                window.allowScripting(undefined);
            }
        );

        getCDNList().then(
            function (data) {

                //fill observable array
                var libraries = data.value;
                for (var i = 0; i < libraries.length; i++) {
                    var cdnEntry = {
                        "Id": libraries[i].Id,
                        "Title": libraries[i].Title,
                        "Type": libraries[i].Type,
                        "Url": window.location.protocol + libraries[i].Url,
                        "Dependency": libraries[i].Dependency,
                        "Active": libraries[i].Active,
                        "Namespace": libraries[i].Namespace,
                        "Validated": ko.observable(undefined),
                        "Sequence": libraries[i].Sequence

                    };
                    window.cdnEntries.push(cdnEntry);
                }

                //validate CDNs
                var deferreds = [];
                ko.utils.arrayForEach(window.cdnEntries(), function (cdnEntry) {
                    deferreds.push(testCDN(cdnEntry));
                });
                $.when.apply(this, deferreds).done(function () { window.validationComplete(true); });
            },
            function () {
                //not implemented
            }
        );
    }

    function removeUserCustomAction(id) {
        var hostWebUrl = getqueryStringValue("SPHostUrl");
        var appWebUrl = getqueryStringValue("SPAppWebUrl");
        var executor = new SP.RequestExecutor(appWebUrl);

        executor.executeAsync({
            url: "../_api/SP.AppContextSite(@target)/web/usercustomactions(guid'" + id + "')" +
                "?@target='" + hostWebUrl + "'",
            method: "DELETE",
            headers: {
                "If-Match": "*",
                "accept": "application/json"
            }
        });

    }

    function addUserCustomAction(script) {

        var hostWebUrl = getqueryStringValue("SPHostUrl");
        var appWebUrl = getqueryStringValue("SPAppWebUrl");
        var executor = new SP.RequestExecutor(appWebUrl);
        var deferred = jQuery.Deferred();

        //Add CDN to host web
        executor.executeAsync({
            url: "../_api/SP.AppContextSite(@target)/web/usercustomactions" +
                "?@target='" + hostWebUrl + "'",
            method: "POST",
            body: JSON.stringify({
                'Sequence': 0,
                'Description': internalName,
                'Location': 'ScriptLink',
                'ScriptBlock': script
            }),
            headers: {
                "content-type": "application/json",
                "accept": "application/json"
            },
            success: function(data) {
                deferred.resolve(JSON.parse(data.body));
            },
            error: function(err) {
                deferred.reject(JSON.parse(err.body)["odata.error"].message.value + " Be sure scripting is enabled in the tenant settings, and that you have site administrator rights.");
            }
        });

        return deferred.promise();

    }

    jQuery(function () {

        ko.applyBindings(cdnViewModel());

        //Manage CDNs
        jQuery("#manageButton").click(function () {
            window.location = "../Lists/CDNs";
            return false;

        });

        //Inject CDNs
        jQuery("#injectButton").click(function () {

            getUserCustomActions().then(
                function(data) {

                    //Remove CDN script if added previously
                    var customActions = data.value;
                    var actionCount = customActions.length;
                    for (var x = 0; x < actionCount; x++) {
                        if (customActions[x].Description === internalName) {
                            removeUserCustomAction(customActions[x].Id);
                            break;
                        }
                    }

                    var activeLibraries = [];

                    //get active and valid libraries
                    ko.utils.arrayForEach(window.cdnEntries(), function(cdnEntry) {
                        if (cdnEntry.Active === true &&
                            cdnEntry.Validated() === true) {

                            activeLibraries[activeLibraries.length] = {
                                "type": cdnEntry.Type,
                                "sequence": cdnEntry.Sequence,
                                "key": cdnEntry.Title,
                                "namespace": cdnEntry.Namespace,
                                "url": cdnEntry.Url,
                                "dependency": cdnEntry.Dependency
                            };
                        }
                    });

                    //Sort libraries
                    activeLibraries.sort(function(a, b) {
                        return (a.sequence - b.sequence);
                    });

                    //Create the script to inject
                    var script = "Type.registerNamespace('" + internalName + "');" +
                        "(function $_global_" + internalName.toLowerCase() + " () {" +
                        "   " + internalName + " = function () {" +
                        "   'use strict';" +
                        "   var load = function () {";
                    var i;
                    var libraryCount = activeLibraries.length;
                    for (i = 0; i < libraryCount; i++) {
                        if (activeLibraries[i].type === "JavaScript") {
                            script = script +
                                "SP.SOD.registerSod('" + activeLibraries[i].key + "', '" + activeLibraries[i].url + "');";
                            if (typeof(activeLibraries[i].dependency) !== "undefined" &&
                                activeLibraries[i].dependency !== null) {
                                script = script +
                                    "RegisterSodDep('" + activeLibraries[i].key + "','" + activeLibraries[i].dependency + "');";
                            }
                        }
                        if (activeLibraries[i].type === "StyleSheet") {
                            script = script +
                                "link = document.createElement('link');" +
                                "link.href = " + activeLibraries[i].url + ";" +
                                "link.type = 'text/css';" +
                                "link.rel = 'stylesheet';" +
                                "document.getElementsByTagName('header')[0].appendChild(link);";
                        }
                    }
                    script = script + " " +
                        "   };" +
                        "   var checkLoadedLoop = function (key, namespace, attempts) {" +
                        "     attempts ++;" +
                        "     if(!objectExists(namespace)){" +
                        "       if(attempts<500) {" +
                        "         setTimeout(function() {" +
                        "           checkLoadedLoop(key, namespace, attempts);" +
                        "         }, 10);" +
                        "       }" +
                        "       else {" +
                        "         console.log('[" + internalName + "] Exceeded maximum load attempts for ' + key);" +
                        "       }" +
                        "     }" +
                        "     else{" +
                        "        console.log('[" + internalName + "] Successfully loaded ' + key);" +
                        "        Type.registerNamespace(namespace);" +
                        "        notifySOD(key);" +
                        "     }" +
                        "   };" +
                        "   var objectExists = function (name) {" +
                        "    var index = 0," +
                        "    parts = name.split('.')," +
                        "    result;" +
                        "    result = window;" +
                        "    index = 0;" +
                        "    try {" +
                        "      while (typeof(result) !== 'undefined' && result !== null && index < parts.length) {" +
                        "        result = result[parts[index++]];" +
                        "      }" +
                        "    }" +
                        "    catch (e) {" +
                        "    }" +
                        "     if (index < parts.length) {" +
                        "       return false;" +
                        "     }" +
                        "     return true;" +
                        "   };" +
                        "   var notifySOD = function (key) {" +
                        "     if (typeof (NotifyScriptLoadedAndExecuteWaitingJobs) === 'function') {" +
                        "       NotifyScriptLoadedAndExecuteWaitingJobs(key);    " +
                        "     }" +
                        "     else {" +
                        "       console.log('[" + internalName + "] SharePoint context not found.');" +
                        "     }" +
                        "   };" +
                        "   var getNamespaceFromKey = function (key) {" +
                        "     switch(key) {";
                    for (i = 0; i < libraryCount; i++) {
                        if (activeLibraries[i].type === "JavaScript") {
                            script = script +
                                "case '" + activeLibraries[i].key + "':" +
                                "  return '" + activeLibraries[i].namespace + ".constructor';";
                        }
                    }
                    script = script +
                        "       default:" +
                        "         console.log('[" + internalName + "] Could not find namespace for key ' + key);" +
                        "         return undefined;" +
                        "     }" +
                        "   };" +
                        "   var getScript = function (key,callback) {" +
                        "     if (typeof key == 'string') {" +
                        "        SP.SOD.executeFunc(key, getNamespaceFromKey(key), function() {" +
                        "          console.log('[" + internalName + "] Namespace loaded: ' + getNamespaceFromKey(key));" +
                        "        }, false);" +
                        "        SP.SOD.executeOrDelayUntilScriptLoaded(callback, key);" +
                        "        checkLoadedLoop(key, getNamespaceFromKey(key), 0);" +
                        "     } else if (typeof(key.length) !== 'undefined') {" +
                        "        SP.SOD.loadMultiple(key, callback, false);" +
                        "        for(var i=0;i<key.length;i++) {" +
                        "          checkLoadedLoop(key[i], getNamespaceFromKey(key[i]), 0);" +
                        "        }" +
                        "     } else {" +
                        "       console.log('[" + internalName + "] Malformed key: ' + key);" +
                        "       return false;" +
                        "     }" +
                        "   };" +
                        "   return {" +
                        "     load: load," +
                        "     getScript: getScript" +
                        "   };" +
                        "}();" +
                        "})();" +
                        "" + internalName + ".load();";

                    return addUserCustomAction(script);
                }
            ).done(
                function() {
                    SP.UI.Notify.addNotification("CDNs added to host web");
                }
            ).fail(
                function(err) {
                    SP.UI.Notify.addNotification("CDNs injection failed. " + err);
                }
            );
            return false;
        });

        //Remove CDNs
        jQuery("#removeButton").click(function () {

            getUserCustomActions().then(
                function(data) {

                    //Remove CDN script if added previously
                    var customActions = data.value;
                    var customActionCount = customActions.length;
                    for (var x = 0; x < customActionCount; x++) {
                        if (customActions[x].Description === internalName) {
                            removeUserCustomAction(customActions[x].Id);
                            break;
                        }
                    }
                }
            ).done(
                function() {
                    SP.UI.Notify.addNotification("CDNs removed from host web");
                }
            ).fail(
                function(err) {
                    alert(err);
                }
            );

            return false;

        });

    });
}());

