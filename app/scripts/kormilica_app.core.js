/**
 * @license almond 0.2.9 Copyright (c) 2011-2014, The Dojo Foundation All Rights Reserved.
 * Available via the MIT or new BSD license.
 * see: http://github.com/jrburke/almond for details
 */
//Going sloppy to avoid 'use strict' string cost, but strict practices should
//be followed.
/*jslint sloppy: true */
/*global setTimeout: false */

var requirejs, require, define;
(function (undef) {
    var main, req, makeMap, handlers,
        defined = {},
        waiting = {},
        config = {},
        defining = {},
        hasOwn = Object.prototype.hasOwnProperty,
        aps = [].slice,
        jsSuffixRegExp = /\.js$/;

    function hasProp(obj, prop) {
        return hasOwn.call(obj, prop);
    }

    /**
     * Given a relative module name, like ./something, normalize it to
     * a real name that can be mapped to a path.
     * @param {String} name the relative name
     * @param {String} baseName a real name that the name arg is relative
     * to.
     * @returns {String} normalized name
     */
    function normalize(name, baseName) {
        var nameParts, nameSegment, mapValue, foundMap, lastIndex,
            foundI, foundStarMap, starI, i, j, part,
            baseParts = baseName && baseName.split("/"),
            map = config.map,
            starMap = (map && map['*']) || {};

        //Adjust any relative paths.
        if (name && name.charAt(0) === ".") {
            //If have a base name, try to normalize against it,
            //otherwise, assume it is a top-level require that will
            //be relative to baseUrl in the end.
            if (baseName) {
                //Convert baseName to array, and lop off the last part,
                //so that . matches that "directory" and not name of the baseName's
                //module. For instance, baseName of "one/two/three", maps to
                //"one/two/three.js", but we want the directory, "one/two" for
                //this normalization.
                baseParts = baseParts.slice(0, baseParts.length - 1);
                name = name.split('/');
                lastIndex = name.length - 1;

                // Node .js allowance:
                if (config.nodeIdCompat && jsSuffixRegExp.test(name[lastIndex])) {
                    name[lastIndex] = name[lastIndex].replace(jsSuffixRegExp, '');
                }

                name = baseParts.concat(name);

                //start trimDots
                for (i = 0; i < name.length; i += 1) {
                    part = name[i];
                    if (part === ".") {
                        name.splice(i, 1);
                        i -= 1;
                    } else if (part === "..") {
                        if (i === 1 && (name[2] === '..' || name[0] === '..')) {
                            //End of the line. Keep at least one non-dot
                            //path segment at the front so it can be mapped
                            //correctly to disk. Otherwise, there is likely
                            //no path mapping for a path starting with '..'.
                            //This can still fail, but catches the most reasonable
                            //uses of ..
                            break;
                        } else if (i > 0) {
                            name.splice(i - 1, 2);
                            i -= 2;
                        }
                    }
                }
                //end trimDots

                name = name.join("/");
            } else if (name.indexOf('./') === 0) {
                // No baseName, so this is ID is resolved relative
                // to baseUrl, pull off the leading dot.
                name = name.substring(2);
            }
        }

        //Apply map config if available.
        if ((baseParts || starMap) && map) {
            nameParts = name.split('/');

            for (i = nameParts.length; i > 0; i -= 1) {
                nameSegment = nameParts.slice(0, i).join("/");

                if (baseParts) {
                    //Find the longest baseName segment match in the config.
                    //So, do joins on the biggest to smallest lengths of baseParts.
                    for (j = baseParts.length; j > 0; j -= 1) {
                        mapValue = map[baseParts.slice(0, j).join('/')];

                        //baseName segment has  config, find if it has one for
                        //this name.
                        if (mapValue) {
                            mapValue = mapValue[nameSegment];
                            if (mapValue) {
                                //Match, update name to the new value.
                                foundMap = mapValue;
                                foundI = i;
                                break;
                            }
                        }
                    }
                }

                if (foundMap) {
                    break;
                }

                //Check for a star map match, but just hold on to it,
                //if there is a shorter segment match later in a matching
                //config, then favor over this star map.
                if (!foundStarMap && starMap && starMap[nameSegment]) {
                    foundStarMap = starMap[nameSegment];
                    starI = i;
                }
            }

            if (!foundMap && foundStarMap) {
                foundMap = foundStarMap;
                foundI = starI;
            }

            if (foundMap) {
                nameParts.splice(0, foundI, foundMap);
                name = nameParts.join('/');
            }
        }

        return name;
    }

    function makeRequire(relName, forceSync) {
        return function () {
            //A version of a require function that passes a moduleName
            //value for items that may need to
            //look up paths relative to the moduleName
            return req.apply(undef, aps.call(arguments, 0).concat([relName, forceSync]));
        };
    }

    function makeNormalize(relName) {
        return function (name) {
            return normalize(name, relName);
        };
    }

    function makeLoad(depName) {
        return function (value) {
            defined[depName] = value;
        };
    }

    function callDep(name) {
        if (hasProp(waiting, name)) {
            var args = waiting[name];
            delete waiting[name];
            defining[name] = true;
            main.apply(undef, args);
        }

        if (!hasProp(defined, name) && !hasProp(defining, name)) {
            throw new Error('No ' + name);
        }
        return defined[name];
    }

    //Turns a plugin!resource to [plugin, resource]
    //with the plugin being undefined if the name
    //did not have a plugin prefix.
    function splitPrefix(name) {
        var prefix,
            index = name ? name.indexOf('!') : -1;
        if (index > -1) {
            prefix = name.substring(0, index);
            name = name.substring(index + 1, name.length);
        }
        return [prefix, name];
    }

    /**
     * Makes a name map, normalizing the name, and using a plugin
     * for normalization if necessary. Grabs a ref to plugin
     * too, as an optimization.
     */
    makeMap = function (name, relName) {
        var plugin,
            parts = splitPrefix(name),
            prefix = parts[0];

        name = parts[1];

        if (prefix) {
            prefix = normalize(prefix, relName);
            plugin = callDep(prefix);
        }

        //Normalize according
        if (prefix) {
            if (plugin && plugin.normalize) {
                name = plugin.normalize(name, makeNormalize(relName));
            } else {
                name = normalize(name, relName);
            }
        } else {
            name = normalize(name, relName);
            parts = splitPrefix(name);
            prefix = parts[0];
            name = parts[1];
            if (prefix) {
                plugin = callDep(prefix);
            }
        }

        //Using ridiculous property names for space reasons
        return {
            f: prefix ? prefix + '!' + name : name, //fullName
            n: name,
            pr: prefix,
            p: plugin
        };
    };

    function makeConfig(name) {
        return function () {
            return (config && config.config && config.config[name]) || {};
        };
    }

    handlers = {
        require: function (name) {
            return makeRequire(name);
        },
        exports: function (name) {
            var e = defined[name];
            if (typeof e !== 'undefined') {
                return e;
            } else {
                return (defined[name] = {});
            }
        },
        module: function (name) {
            return {
                id: name,
                uri: '',
                exports: defined[name],
                config: makeConfig(name)
            };
        }
    };

    main = function (name, deps, callback, relName) {
        var cjsModule, depName, ret, map, i,
            args = [],
            callbackType = typeof callback,
            usingExports;

        //Use name if no relName
        relName = relName || name;

        //Call the callback to define the module, if necessary.
        if (callbackType === 'undefined' || callbackType === 'function') {
            //Pull out the defined dependencies and pass the ordered
            //values to the callback.
            //Default to [require, exports, module] if no deps
            deps = !deps.length && callback.length ? ['require', 'exports', 'module'] : deps;
            for (i = 0; i < deps.length; i += 1) {
                map = makeMap(deps[i], relName);
                depName = map.f;

                //Fast path CommonJS standard dependencies.
                if (depName === "require") {
                    args[i] = handlers.require(name);
                } else if (depName === "exports") {
                    //CommonJS module spec 1.1
                    args[i] = handlers.exports(name);
                    usingExports = true;
                } else if (depName === "module") {
                    //CommonJS module spec 1.1
                    cjsModule = args[i] = handlers.module(name);
                } else if (hasProp(defined, depName) ||
                           hasProp(waiting, depName) ||
                           hasProp(defining, depName)) {
                    args[i] = callDep(depName);
                } else if (map.p) {
                    map.p.load(map.n, makeRequire(relName, true), makeLoad(depName), {});
                    args[i] = defined[depName];
                } else {
                    throw new Error(name + ' missing ' + depName);
                }
            }

            ret = callback ? callback.apply(defined[name], args) : undefined;

            if (name) {
                //If setting exports via "module" is in play,
                //favor that over return value and exports. After that,
                //favor a non-undefined return value over exports use.
                if (cjsModule && cjsModule.exports !== undef &&
                        cjsModule.exports !== defined[name]) {
                    defined[name] = cjsModule.exports;
                } else if (ret !== undef || !usingExports) {
                    //Use the return value from the function.
                    defined[name] = ret;
                }
            }
        } else if (name) {
            //May just be an object definition for the module. Only
            //worry about defining if have a module name.
            defined[name] = callback;
        }
    };

    requirejs = require = req = function (deps, callback, relName, forceSync, alt) {
        if (typeof deps === "string") {
            if (handlers[deps]) {
                //callback in this case is really relName
                return handlers[deps](callback);
            }
            //Just return the module wanted. In this scenario, the
            //deps arg is the module name, and second arg (if passed)
            //is just the relName.
            //Normalize module name, if it contains . or ..
            return callDep(makeMap(deps, callback).f);
        } else if (!deps.splice) {
            //deps is a config object, not an array.
            config = deps;
            if (config.deps) {
                req(config.deps, config.callback);
            }
            if (!callback) {
                return;
            }

            if (callback.splice) {
                //callback is an array, which means it is a dependency list.
                //Adjust args if there are dependencies
                deps = callback;
                callback = relName;
                relName = null;
            } else {
                deps = undef;
            }
        }

        //Support require(['a'])
        callback = callback || function () {};

        //If relName is a function, it is an errback handler,
        //so remove it.
        if (typeof relName === 'function') {
            relName = forceSync;
            forceSync = alt;
        }

        //Simulate async callback;
        if (forceSync) {
            main(undef, deps, callback, relName);
        } else {
            //Using a non-zero value because of concern for what old browsers
            //do, and latest browsers "upgrade" to 4 if lower value is used:
            //http://www.whatwg.org/specs/web-apps/current-work/multipage/timers.html#dom-windowtimers-settimeout:
            //If want a value immediately, use require('id') instead -- something
            //that works in almond on the global level, but not guaranteed and
            //unlikely to work in other AMD implementations.
            setTimeout(function () {
                main(undef, deps, callback, relName);
            }, 4);
        }

        return req;
    };

    /**
     * Just drops the config on the floor, but returns req in case
     * the config return value is used.
     */
    req.config = function (cfg) {
        return req(cfg);
    };

    /**
     * Expose module registry for debugging and tooling
     */
    requirejs._defined = defined;

    define = function (name, deps, callback) {

        //This module may not have dependencies
        if (!deps.splice) {
            //deps is not an array, so probably means
            //an object literal or factory function for
            //the value. Adjust args.
            callback = deps;
            deps = [];
        }

        if (!hasProp(defined, name) && !hasProp(waiting, name)) {
            waiting[name] = [name, deps, callback];
        }
    };

    define.amd = {
        jQuery: true
    };
}());

define("almond", function(){});

(function() {
  define('templates/modal_windows/quantity_selector',[],function() {
    return function(context) {
      var render;
      render = function() {
        var $o;
        $o = [];
        $o.push("<div class='kormapp-modal-wrapper'>\n  <div class='kormapp-modal-window' role='kormapp-modal-content'>\n    <div class='kormapp-modal-window-white'>\n      <div class='kormapp-quantity-title'>Введите количество</div>\n      <table class='kormapp-quantity-table'>\n        <tr>\n          <td>\n            <p class='kormapp-price'>\n              <span class='kormapp-quantity-price' role='kormapp-quantity-price'></span>\n            </p>\n          </td>\n          <td>\n            <p class='kormapp-multiplier'>x\n              <span class='kormapp-multiplier-font kormapp-quantity' role='kormapp-quantity'></span>\n              \=\n            </p>\n          </td>\n          <td>\n            <p class='kormapp-price kormapp-result' role='kormapp-result'></p>\n          </td>\n        </tr>\n      </table>\n      <div class='kormapp-quantity-selector'>\n        <a class='kormapp-quantity-selector-button kormapp-reflection' href='#' role='kormapp-minus-sign'>-</a>\n        <span class='kormapp-quantity' role='kormapp-quantity'>" + this.quantity + "</span>\n        шт\n        <a class='kormapp-quantity-selector-button kormapp-reflection' href='#' role='kormapp-plus-sign'>+</a>\n      </div>\n      <a class='kormapp-modal-button kormapp-reflection' href='#' role='kormapp-modal-button'>\n        <span class='kormapp-modal-button-text'>ГОТОВО</span>\n      </a>\n    </div>\n  </div>\n</div>");
        return $o.join("\n").replace(/\s(?:id|class)=(['"])(\1)/mg, "");
      };
      return render.call(context);
    };
  });

}).call(this);

(function() {
  define('helpers/application_helpers',[],function() {
    return {
      ficon: function(name, attrs) {
        return "<i class='fontello-icon-" + name + "'></i>";
      },
      badge: function(text, type) {
        return "<span class=\"badge badge-" + (type ? type : "default") + "\">" + text + "</span>";
      },
      truncate: function(string, size) {
        var new_string, words_array;
        if (size == null) {
          size = 100;
        }
        if (string.length < size) {
          return string;
        }
        words_array = $.trim(string).substring(0, size).split(' ');
        new_string = words_array.join(" ") + "&hellip;";
        return new_string;
      },
      url: function(url_name) {
        return App.urls[url_name] || ("Неизвестный url_name " + url_name);
      },
      money: function(value) {
        return "<span class='kormapp-price-font'>" + (value.cents / 100) + "</span> р.";
      },
      money_txt: function(value) {
        return "" + (value.cents / 100) + " руб.";
      },
      moneyWithoutCurrency: function(value) {
        return "" + (value.cents / 100);
      }
    };
  });

}).call(this);

(function() {
  var __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

  define('views/modal_windows/quantity_selector',['templates/modal_windows/quantity_selector', 'helpers/application_helpers'], function(template, Helpers) {
    var QuantitySelector, _ref;
    return QuantitySelector = (function(_super) {
      __extends(QuantitySelector, _super);

      function QuantitySelector() {
        _ref = QuantitySelector.__super__.constructor.apply(this, arguments);
        return _ref;
      }

      QuantitySelector.prototype.template = template;

      QuantitySelector.prototype.templateHelpers = function() {
        return Helpers;
      };

      QuantitySelector.prototype.ui = {
        plusButton: '@kormapp-plus-sign',
        minusButton: '@kormapp-minus-sign',
        confirmButton: '@kormapp-modal-button',
        result: '@kormapp-result',
        content: '@kormapp-modal-content'
      };

      QuantitySelector.prototype.bindings = {
        '@kormapp-quantity': 'quantity',
        '@kormapp-result': {
          observe: 'total_cost',
          updateMethod: 'html',
          onGet: function() {
            return Helpers.money(this.model.get('total_cost'));
          }
        }
      };

      QuantitySelector.prototype.events = {
        'click @ui.minusButton': 'decreaseQuantity',
        'click @ui.plusButton': 'increaseQuantity',
        'click @ui.confirmButton': 'confirmChanges',
        'click': 'close',
        'click @ui.content': 'stopEvent'
      };

      QuantitySelector.prototype.decreaseQuantity = function(e) {
        e.preventDefault();
        if (!(this.model.get('quantity') < 1)) {
          this.model.set('quantity', this.model.get('quantity') - 1);
          return this.model.save();
        }
      };

      QuantitySelector.prototype.increaseQuantity = function(e) {
        e.preventDefault();
        this.model.set('quantity', this.model.get('quantity') + 1);
        return this.model.save();
      };

      QuantitySelector.prototype.confirmChanges = function(e) {
        e.preventDefault();
        return this.close();
      };

      QuantitySelector.prototype.onClose = function() {
        if (this.model.get('quantity') === 0) {
          return this.model.destroy();
        }
      };

      QuantitySelector.prototype.onRender = function() {
        this.stickit();
        return this.stickit(this.model.product, {
          '@kormapp-quantity-price': {
            observe: 'price',
            updateMethod: 'html',
            onGet: function() {
              return Helpers.money(this.model.product.get('price'));
            }
          }
        });
      };

      QuantitySelector.prototype.stopEvent = function(e) {
        return e.stopPropagation();
      };

      return QuantitySelector;

    })(Marionette.ItemView);
  });

}).call(this);

(function() {
  var __bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; },
    __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

  define('controllers/cart',['views/modal_windows/quantity_selector'], function(QuantitySelectorView) {
    var CartController, _ref;
    return CartController = (function(_super) {
      __extends(CartController, _super);

      function CartController() {
        this.productClick = __bind(this.productClick, this);
        _ref = CartController.__super__.constructor.apply(this, arguments);
        return _ref;
      }

      CartController.prototype.initialize = function(options) {
        var _this = this;
        this.vent = options.vent, this.modal = options.modal, this.cart = options.cart;
        this.vent.on('product:click', this.productClick);
        return this.vent.on('order:created', function() {
          return _this.cleanCart();
        });
      };

      CartController.prototype.productClick = function(product) {
        var item;
        item = this.cart.items.itemOfProduct(product);
        if (item) {
          return this.modal.show(new QuantitySelectorView({
            model: item
          }));
        } else {
          return this.cart.addProduct(product);
        }
      };

      CartController.prototype.cleanCart = function() {
        var model, _results;
        _results = [];
        while (model = this.cart.items.first()) {
          _results.push(model.destroy());
        }
        return _results;
      };

      return CartController;

    })(Marionette.Controller);
  });

}).call(this);

(function() {
  define('templates/check/check',[],function() {
    return function(context) {
      var render;
      render = function() {
        var $o;
        $o = [];
        $o.push("<div class='kormapp-check-external'>\n  <div class='kormapp-check-internal'>\n    <div class='kormapp-check-background-container'>\n      <div class='kormapp-check-content' role='kormapp-check-content'>\n        <div class='kormapp-check-header'>\n          <a class='kormapp-check-back-button-link' href='#' role='kormapp-check-back-button'>\n            <span class='kormapp-back-button'></span>\n          </a>\n          <h2 class='kormapp-check-heading'>Ваш чек</h2>\n        </div>\n        <div class='clearfix'></div>\n        <div class='kormapp-check-info' role='kormapp-check-info'>\n          <div class='kormapp-check-offer' role='kormapp-check-offer'></div>\n          <div class='kormapp-check-free-delivery' role='kormapp-check-free-delivery'></div>\n        </div>\n        <div class='kormapp-scrollable-check' role='kormapp-check-items-list'>\n          <ol class='kormapp-cart-items' role='kormapp-cart-items'></ol>\n        </div>\n        <div class='kormapp-unscrollable-check' role='kormapp-check-bottom-info'>\n          <div class='kormapp-row-clearfix'>\n            <p class='kormapp-delivery-price' role='kormapp-delivery-price'>Стоимость доставки\n              <span class='kormapp-delivery-sum-right' role='kormapp-delivery-sum-right'></span>\n            </p>\n            <p class='kormapp-all-product-sum'>Итог:\n              <span class='kormapp-all-sum-right' role='kormapp-all-sum-right'></span>\n            </p>\n          </div>\n        </div>\n      </div>\n    </div>\n  </div>\n  <div class='kormapp-check-bottom-container'>\n    <div class='kormapp-check-bottom'>\n      <div class='kormapp-container'>\n        <div class='kormapp-check-short-left'></div>\n        <div class='kormapp-check-short-right'></div>\n        <div class='kormapp-check-short-center'></div>\n      </div>\n    </div>\n    <div class='kormapp-check-delivery-button' role='kormapp-check-continue-button'>\n      <a class='kormapp-check-button-link' href='#777'>\n        <span class='kormapp-delivery-button'>ОФОРМИТЬ ЗАКАЗ</span>\n      </a>\n    </div>\n  </div>\n</div>");
        return $o.join("\n").replace(/\s(?:id|class)=(['"])(\1)/mg, "");
      };
      return render.call(context);
    };
  });

}).call(this);

(function() {
  define('templates/check/check_cart_item',[],function() {
    return function(context) {
      var render;
      render = function() {
        var $o;
        $o = [];
        $o.push("<p class='kormapp-cartitem-name' role='kormapp-cartitem-name'></p>\n<table>\n  <tbody>\n    <tr>\n      <td class='kormapp-product-amount'>\n        <span class='kormapp-cartitem-product-price' role='kormapp-cartitem-product-price'></span>\n        x\n        <span class='kormapp-cartitem-product-quantity' role='kormapp-cartitem-product-quantity'></span>\n      </td>\n      <td class='kormapp-separator'>\n        <div class='separator-placeholder'></div>\n      </td>\n      <!-- / TODO Мультивалютность -->\n      <td class='kormapp-product-price' role='kormapp-product-price'></td>\n    </tr>\n  </tbody>\n</table>");
        return $o.join("\n").replace(/\s(?:id|class)=(['"])(\1)/mg, "");
      };
      return render.call(context);
    };
  });

}).call(this);

(function() {
  var __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

  define('views/check/check_cart_item',['templates/check/check_cart_item', 'helpers/application_helpers'], function(checkCartItemViewTemplate, Helpers) {
    var CheckCartItemView, _ref;
    return CheckCartItemView = (function(_super) {
      __extends(CheckCartItemView, _super);

      function CheckCartItemView() {
        _ref = CheckCartItemView.__super__.constructor.apply(this, arguments);
        return _ref;
      }

      CheckCartItemView.prototype.template = checkCartItemViewTemplate;

      CheckCartItemView.prototype.templateHelpers = function() {
        return Helpers;
      };

      CheckCartItemView.prototype.tagName = 'li';

      CheckCartItemView.prototype.bindings = {
        '@kormapp-cartitem-product-quantity': 'quantity',
        '@kormapp-product-price': {
          observe: 'total_cost',
          updateMethod: 'html',
          onGet: function(val) {
            return Helpers.money(val);
          }
        }
      };

      CheckCartItemView.prototype.onRender = function() {
        this.stickit();
        return this.stickit(this.model.product, {
          '@kormapp-cartitem-name': 'title',
          '@kormapp-cartitem-product-price': {
            observe: 'price',
            onGet: function(val) {
              return Helpers.moneyWithoutCurrency(val);
            }
          }
        });
      };

      return CheckCartItemView;

    })(Marionette.ItemView);
  });

}).call(this);

(function() {
  define('templates/check/check_contacts',[],function() {
    return function(context) {
      var render;
      render = function() {
        var $c, $e, $o;
        $e = function(text, escape) {
          return ("" + text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#39;').replace(/\//g, '&#47;').replace(/"/g, '&quot;');
        };
        $c = function(text) {
          switch (text) {
            case null:
            case void 0:
              return '';
            case true:
            case false:
              return '' + text;
            default:
              return text;
          }
        };
        $o = [];
        $o.push("<div class='kormapp-modal-wrapper'>\n  <div class='kormapp-modal-window' role='kormapp-modal-content'>\n    <div class='kormapp-modal-window-white'>\n      <h1 class='kormapp-modal-title'>Кому доставка?</h1>\n      <form class='order-data' role='kormapp-contact-form' name='message\", method=>\"post'>\n        <section>\n          <label for='phone'>Телефон:</label>\n          <div class='kormapp-phone-input-group'>\n            <div class='kormapp-phone-input-prefix'>" + ($e($c(this.phone_prefix))) + "</div>\n            <input class='kormapp-phone-input' role='kormapp-phone' type='tel' name='phone' placeholder='XXX-XXX-XXXX' minlength='" + ($e($c(10))) + "' maxlength='" + ($e($c(15))) + "'>\n          </div>\n          <label role='kormapp-address-label' for='address'>Ваш адрес:</label>\n          <input type='text' name='address' role='kormapp-address'>\n        </section>\n        <p class='kormapp-form-comment'>\n          обязательно введите\n          <br>\n          свой телефон для связи\n        </p>\n      </form>\n      <div class='kormapp-check-button kormapp-delivery kormapp-full kormapp-reflection' role='kormapp-delivery-block'>\n        <a class='kormapp-check-button-link' href='#777' role='kormapp-delivery-button'>\n          <span class='kormapp-delivery-button' role='kormapp-delivery-button-content'>ДОСТАВИТЬ ЗАКАЗ</span>\n        </a>\n      </div>\n      <div class='kormapp-check-button kormapp-delivery-inactive kormapp-full kormapp-reflection' role='kormapp-delivery-block-inactive'>\n        <a class='kormapp-check-button-link' href='#777' role='kormapp-delivery-button'>\n          <span class='kormapp-delivery-button' role='kormapp-delivery-button-content'>ДОСТАВИТЬ ЗАКАЗ</span>\n        </a>\n      </div>\n    </div>\n  </div>\n</div>");
        return $o.join("\n").replace(/\s([\w-]+)='true'/mg, ' $1').replace(/\s([\w-]+)='false'/mg, '').replace(/\s(?:id|class)=(['"])(\1)/mg, "");
      };
      return render.call(context);
    };
  });

}).call(this);

(function() {
  var __bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; },
    __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

  define('views/check/check_contacts',['templates/check/check_contacts', 'helpers/application_helpers'], function(template, Helpers) {
    var CheckContactsView, _ref;
    return CheckContactsView = (function(_super) {
      __extends(CheckContactsView, _super);

      function CheckContactsView() {
        this.activateDeliveryButton = __bind(this.activateDeliveryButton, this);
        this.deactivateDeliveryButton = __bind(this.deactivateDeliveryButton, this);
        _ref = CheckContactsView.__super__.constructor.apply(this, arguments);
        return _ref;
      }

      CheckContactsView.prototype.template = template;

      CheckContactsView.prototype.templateHelpers = function() {
        return Helpers;
      };

      CheckContactsView.prototype.phoneLength = 10;

      CheckContactsView.prototype.addressLength = 3;

      CheckContactsView.prototype.initialize = function(_arg) {
        this.app = _arg.app, this.user = _arg.user, this.modal = _arg.modal, this.vendor = _arg.vendor;
        this.model = this.user;
        return this.app.vent.on('order:failed', this.activateDeliveryButton);
      };

      CheckContactsView.prototype.bindings = {
        '@kormapp-address': {
          observe: 'address'
        },
        '@kormapp-phone': {
          observe: 'phone',
          onSet: function(val) {
            this.phone = val.replace(/\D/g, '');
            return this.phone;
          }
        }
      };

      CheckContactsView.prototype.ui = {
        form: '@kormapp-contact-form',
        deliveryBlock: '@kormapp-delivery-block',
        deliveryBlockInactive: '@kormapp-delivery-block-inactive',
        deliveryButtonContent: '@kormapp-delivery-button-content',
        content: '@kormapp-modal-content'
      };

      CheckContactsView.prototype.events = {
        'click @ui.deliveryBlock': 'addOrder',
        'click @ui.deliveryBlockInactive': 'showErrors',
        'keyup @ui.form': 'manageButtons',
        'click': 'clickAnywhere',
        'click @ui.form, click @ui.content': 'stopEvent'
      };

      CheckContactsView.prototype.serializeData = function() {
        return _.extend(this.user.toJSON());
      };

      CheckContactsView.prototype.stopEvent = function(e) {
        return e.stopPropagation();
      };

      CheckContactsView.prototype.clickAnywhere = function() {
        this.adjustScreen();
        return this.close();
      };

      CheckContactsView.prototype.adjustScreen = function(callback) {
        return setTimeout((function() {
          return $('body').scrollTop(0);
        }), 100);
      };

      CheckContactsView.prototype.addOrder = function(e) {
        e.stopPropagation();
        this.user.save();
        $(this.ui.deliveryButtonContent).html('ОТПРАВЛЯЕМ...');
        this.deactivateDeliveryButton();
        return this.app.vent.trigger('order:checkout');
      };

      CheckContactsView.prototype.showErrors = function(e) {
        e.preventDefault();
        return window.navigator.notification.alert('Впишите телефон и адрес доставки', null, 'Внимание');
      };

      CheckContactsView.prototype.validate = function(e) {
        var _ref1, _ref2;
        return ((_ref1 = this.model.get('phone')) != null ? _ref1.toString().length : void 0) >= this.phoneLength && ((_ref2 = this.model.get('address')) != null ? _ref2.toString().length : void 0) >= this.addressLength;
      };

      CheckContactsView.prototype.manageButtons = function(model) {
        if (this.validate()) {
          return this.activateDeliveryButton();
        } else {
          return this.deactivateDeliveryButton();
        }
      };

      CheckContactsView.prototype.deactivateDeliveryButton = function() {
        this.ui.deliveryBlock.hide();
        return this.ui.deliveryBlockInactive.show();
      };

      CheckContactsView.prototype.activateDeliveryButton = function() {
        this.ui.deliveryBlock.show();
        return this.ui.deliveryBlockInactive.hide();
      };

      CheckContactsView.prototype.onShow = function() {
        return this.manageButtons();
      };

      CheckContactsView.prototype.onRender = function() {
        this.ui.deliveryBlock.hide();
        this.ui.deliveryBlockInactive.show();
        this.stickit();
        return this.stickit(this.vendor, {
          '@kormapp-address-label': {
            observe: 'city',
            onGet: function(val) {
              return "Ваш адрес (" + val + ")";
            }
          }
        });
      };

      return CheckContactsView;

    })(Marionette.ItemView);
  });

}).call(this);

(function() {
  var __bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; },
    __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

  define('views/check/check',['templates/check/check', 'views/check/check_cart_item', 'views/check/check_contacts', 'helpers/application_helpers'], function(template, CheckCartItemView, CheckContactsView, Helpers) {
    var CheckView, _ref;
    return CheckView = (function(_super) {
      __extends(CheckView, _super);

      function CheckView() {
        this.continueOrder = __bind(this.continueOrder, this);
        _ref = CheckView.__super__.constructor.apply(this, arguments);
        return _ref;
      }

      CheckView.prototype.template = template;

      CheckView.prototype.templateHelpers = function() {
        return Helpers;
      };

      CheckView.prototype.itemView = CheckCartItemView;

      CheckView.prototype.itemViewContainer = '@kormapp-cart-items';

      CheckView.prototype.className = 'kormapp-check-block';

      CheckView.prototype.emptyCheckClass = 'kormapp-empty-check';

      CheckView.prototype.initialize = function(_arg) {
        var _this = this;
        this.app = _arg.app, this.cart = _arg.cart, this.user = _arg.user, this.vendor = _arg.vendor, this.modal = _arg.modal;
        this.collection = this.cart.items;
        this.model = this.user;
        this.app.vent.on('order:failed', this.activateDeliveryButton);
        return this.listenTo(this.collection, 'add remove reset', function() {
          return _this._manageContinueButton();
        });
      };

      CheckView.prototype.ui = {
        backButton: '@kormapp-check-back-button',
        continueButton: '@kormapp-check-continue-button',
        checkInfo: '@kormapp-check-info',
        bottomInfo: '@kormapp-check-bottom-info',
        itemsList: '@kormapp-check-items-list'
      };

      CheckView.prototype.events = {
        'click @ui.continueButton': 'continueOrder'
      };

      CheckView.prototype.triggers = {
        'click @ui.backButton': {
          event: 'cancel:button:clicked',
          preventDefault: true
        }
      };

      CheckView.prototype.serializeData = function() {
        return _.extend(this.cart.toJSON(), {
          items: this.cart.items.toJSON(),
          user: this.user,
          vendor: this.vendor,
          total_cost_with_delivery: {
            cents: this.cart.get('total_cost').cents + this.vendor.get('delivery_price').cents
          }
        });
      };

      CheckView.prototype.onShow = function() {
        return this._setScrollableAreaHeight();
      };

      CheckView.prototype.onRender = function() {
        var _this = this;
        this.stickit();
        this.stickit(this.vendor, {
          '@kormapp-delivery-price': {
            observe: 'delivery_price',
            visible: function(val) {
              return val.cents > 0;
            }
          },
          '@kormapp-delivery-sum-right': {
            observe: 'delivery_price',
            updateMethod: 'html',
            onGet: function(val) {
              return Helpers.money(val);
            }
          },
          '@kormapp-check-offer': {
            observe: 'mobile_footer',
            updateMethod: 'html'
          },
          '@kormapp-check-free-delivery': {
            observe: 'mobile_delivery',
            updateMethod: 'html'
          }
        });
        this.stickit(this.cart, {
          '@kormapp-all-sum-right': {
            observe: 'total_cost',
            updateMethod: 'html',
            update: function($el, val) {
              var result;
              if (val.cents > 0) {
                _this._showSummary();
                _this.$el.removeClass(_this.emptyCheckClass);
                result = {
                  currency: val.currency,
                  cents: val.cents + _this.vendor.get('delivery_price').cents
                };
                return $el.html(Helpers.money(result));
              } else {
                _this._hideSummary();
                return _this.$el.addClass(_this.emptyCheckClass);
              }
            }
          }
        });
        return this._manageContinueButton();
      };

      CheckView.prototype._manageContinueButton = function() {
        if (this.collection.length === 0) {
          this.ui.continueButton.hide();
          return this.ui.checkInfo.show();
        } else {
          this.ui.continueButton.show();
          return this.ui.checkInfo.hide();
        }
      };

      CheckView.prototype._showSummary = function() {
        return this.ui.bottomInfo.show();
      };

      CheckView.prototype._hideSummary = function() {
        return this.ui.bottomInfo.hide();
      };

      CheckView.prototype.continueOrder = function(e) {
        if (this.vendor.isPriceValid(this.cart)) {
          return this.modal.show(new CheckContactsView({
            app: this.app,
            cart: this.cart,
            user: this.user,
            vendor: this.vendor,
            modal: this.modal
          }));
        } else {
          return this._showMinOrderAlert();
        }
      };

      CheckView.prototype._showMinOrderAlert = function() {
        return window.navigator.notification.alert(this.vendor.get('mobile_empty_cart_alert'), null, 'Внимание');
      };

      CheckView.prototype._setScrollableAreaHeight = function() {
        var bottomInfo, itemsList, scrollableHeight;
        if (!this.app.isWide) {
          bottomInfo = this.ui.bottomInfo;
          itemsList = this.ui.itemsList;
          scrollableHeight = this.ui.bottomInfo.position().top - this.ui.itemsList.position().top;
          return this.ui.itemsList.css('height', scrollableHeight);
        }
      };

      return CheckView;

    })(Marionette.CompositeView);
  });

}).call(this);

(function() {
  var __bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; },
    __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

  define('controllers/check',['views/check/check'], function(CheckView) {
    var CheckController, _ref;
    return CheckController = (function(_super) {
      __extends(CheckController, _super);

      function CheckController() {
        this.hideModal = __bind(this.hideModal, this);
        this.hideCheck = __bind(this.hideCheck, this);
        this.showCheck = __bind(this.showCheck, this);
        _ref = CheckController.__super__.constructor.apply(this, arguments);
        return _ref;
      }

      CheckController.prototype.initialize = function(_arg) {
        this.app = _arg.app, this.user = _arg.user, this.cart = _arg.cart, this.vendor = _arg.vendor, this.modal = _arg.modal;
        this.app.commands.setHandler('check:show', this.showCheck);
        this.app.vent.on('order:created device:backbutton', this.hideCheck);
        return this.app.vent.on('order:created order:failed', this.hideModal);
      };

      CheckController.prototype.showCheck = function() {
        this.checkView = new CheckView({
          app: this.app,
          user: this.user,
          cart: this.cart,
          vendor: this.vendor,
          modal: this.modal
        });
        this.checkView.on('cancel:button:clicked', this.hideCheck);
        return this.app.mainLayout.checkRegion.show(this.checkView);
      };

      CheckController.prototype.hideCheck = function() {
        return this.app.mainLayout.checkRegion.close();
      };

      CheckController.prototype.hideModal = function() {
        return this.modal.hide();
      };

      return CheckController;

    })(Marionette.Controller);
  });

}).call(this);

(function() {
  define('templates/header/top_check',[],function() {
    return function(context) {
      var render;
      render = function() {
        var $o;
        $o = [];
        $o.push("<div class='kormapp-top-check'>\n  <span class='kormapp-check-background-image'></span>\n  <img class='kormapp-check-image' role='kormapp-check-image'>\n</div>\n<p class='kormapp-top-check-text'>ваш заказ на \n  <span class='kormapp-amount' role='kormapp-amount'></span>\n</p>");
        return $o.join("\n").replace(/\s(?:id|class)=(['"])(\1)/mg, "");
      };
      return render.call(context);
    };
  });

}).call(this);

(function() {
  var __bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; },
    __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

  define('views/header/top_check',['templates/header/top_check', 'helpers/application_helpers'], function(template, Helpers) {
    var TopCheckView, _ref;
    return TopCheckView = (function(_super) {
      __extends(TopCheckView, _super);

      function TopCheckView() {
        this.showUp = __bind(this.showUp, this);
        this.bounce = __bind(this.bounce, this);
        this.itemRemoved = __bind(this.itemRemoved, this);
        _ref = TopCheckView.__super__.constructor.apply(this, arguments);
        return _ref;
      }

      TopCheckView.prototype.SLIDE_SPEED = 100;

      TopCheckView.prototype.BOUNCE_SPEED = 150;

      TopCheckView.prototype.template = template;

      TopCheckView.prototype.templateHelpers = function() {
        return Helpers;
      };

      TopCheckView.prototype.className = 'kormapp-reflection kormapp-top-check-container';

      TopCheckView.prototype.ui = {
        checkImage: '@kormapp-check-image'
      };

      TopCheckView.prototype.initialize = function(options) {
        this.app = options.app, this.cart = options.cart;
        this.model = this.cart;
        return this.collection = this.cart.items;
      };

      TopCheckView.prototype.bindings = {
        '@kormapp-amount': {
          observe: 'total_cost',
          updateMethod: 'html',
          onGet: function(value) {
            return Helpers.money(value);
          }
        }
      };

      TopCheckView.prototype.events = {
        'click': 'clicked'
      };

      TopCheckView.prototype.collectionEvents = {
        'add': 'itemAdded',
        'remove': 'itemRemoved'
      };

      TopCheckView.prototype.clicked = function() {
        return this.app.vent.trigger('top_check:clicked');
      };

      TopCheckView.prototype.itemAdded = function(val) {
        if (this.model.getNumberOfItems() === 1) {
          this.$el.show();
          return this.showUp();
        }
      };

      TopCheckView.prototype.itemRemoved = function() {
        return this._hideIfEmpty();
      };

      TopCheckView.prototype.bounce = function() {
        if (this.model.isEmpty()) {
          return;
        }
        if (!this.ui.checkImage.is(':visible')) {
          return;
        }
        return this.ui.checkImage.effect('bounce', {
          times: 1
        }, this.BOUNCE_SPEED);
      };

      TopCheckView.prototype.showUp = function() {
        return this.ui.checkImage.finish().css('margin-top', this.checkHeight + this.checkMarginTop).animate({
          marginTop: this.checkMarginTop
        }, this.SLIDE_SPEED).effect('bounce', {
          times: 1
        }, this.BOUNCE_SPEED);
      };

      TopCheckView.prototype._hideIfEmpty = function() {
        var _this = this;
        if (this.model.isEmpty()) {
          return this.ui.checkImage.finish().animate({
            marginTop: this.checkHeight + this.checkMarginTop
          }, this.SLIDE_SPEED, 'swing', function() {
            return _this.$el.fadeOut(_this.SLIDE_SPEED);
          });
        }
      };

      TopCheckView.prototype.onRender = function() {
        this.listenTo(this.model, 'change:total_cost_cents', this.bounce);
        this.checkHeight = 50;
        this.checkMarginTop = 0;
        if (this.model.isEmpty()) {
          this.$el.hide();
        }
        return this.stickit();
      };

      return TopCheckView;

    })(Marionette.ItemView);
  });

}).call(this);

(function() {
  define('templates/header/header_narrow',[],function() {
    return function(context) {
      var render;
      render = function() {
        var $o;
        $o = [];
        $o.push("<div class='kormapp-container'>\n  <div class='kormapp-row-clearfix'>\n    <div class='kormapp-column kormapp-half kormapp-reflection' role='kormapp-logo'>\n      <p class='kormapp-logo-text' role='kormapp-logo-text'></p>\n    </div>\n    <div class='kormapp-column kormapp-half'>\n      <div class='pull-right' role='kormapp-top-check'></div>\n      <div class='clearfix'></div>\n    </div>\n  </div>\n</div>");
        return $o.join("\n").replace(/\s(?:id|class)=(['"])(\1)/mg, "");
      };
      return render.call(context);
    };
  });

}).call(this);

(function() {
  var __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

  define('views/header/header_narrow',['views/header/top_check', 'templates/header/header_narrow', 'helpers/application_helpers'], function(TopCheckView, template, Helpers) {
    var HeaderNarrowView, _ref;
    return HeaderNarrowView = (function(_super) {
      __extends(HeaderNarrowView, _super);

      function HeaderNarrowView() {
        _ref = HeaderNarrowView.__super__.constructor.apply(this, arguments);
        return _ref;
      }

      HeaderNarrowView.prototype.className = 'kormapp-header';

      HeaderNarrowView.prototype.template = template;

      HeaderNarrowView.prototype.regions = {
        checkRegion: '@kormapp-top-check'
      };

      HeaderNarrowView.prototype.bindings = {
        '@kormapp-logo-text': {
          observe: 'mobile_title',
          updateMethod: 'html'
        }
      };

      HeaderNarrowView.prototype.ui = {
        logo: '@kormapp-logo'
      };

      HeaderNarrowView.prototype.triggers = {
        'tap @ui.logo': 'logo:clicked'
      };

      HeaderNarrowView.prototype.initialize = function(_arg) {
        this.app = _arg.app, this.cart = _arg.cart, this.vendor = _arg.vendor;
        this.model = this.vendor;
        return this.checkView = new TopCheckView({
          app: this.app,
          cart: this.cart
        });
      };

      HeaderNarrowView.prototype.onShow = function() {
        return this.checkRegion.show(this.checkView);
      };

      HeaderNarrowView.prototype.onRender = function() {
        this.$el.hammer();
        return this.stickit();
      };

      return HeaderNarrowView;

    })(Marionette.Layout);
  });

}).call(this);

(function() {
  define('templates/header/header_wide',[],function() {
    return function(context) {
      var render;
      render = function() {
        var $o;
        $o = [];
        $o.push("<div class='kormapp-container'>\n  <div class='kormapp-row-clearfix'>\n    <div class='kormapp-column kormapp-half kormapp-reflection' role='kormapp-logo'>\n      <div class='kormapp-header-menu'>\n        <a class='kormapp-header-menu-item' href='#'>О нас</a>\n        |\n        <a class='kormapp-header-menu-item' href='#'>Оплата и доставка</a>\n        |\n        <a class='kormapp-header-menu-item' href='#'>Контакты</a>\n      </div>\n    </div>\n    <div class='kormapp-column kormapp-half'>\n      <div class='pull-right' role='kormapp-top-check'></div>\n      <div class='clearfix'></div>\n    </div>\n  </div>\n</div>");
        return $o.join("\n").replace(/\s(?:id|class)=(['"])(\1)/mg, "");
      };
      return render.call(context);
    };
  });

}).call(this);

(function() {
  var __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

  define('views/header/header_wide',['views/header/header_narrow', 'views/header/top_check', 'templates/header/header_wide', 'helpers/application_helpers'], function(HeaderNarrowView, TopCheckView, template, Helpers) {
    var HeaderWideView, _ref;
    return HeaderWideView = (function(_super) {
      __extends(HeaderWideView, _super);

      function HeaderWideView() {
        _ref = HeaderWideView.__super__.constructor.apply(this, arguments);
        return _ref;
      }

      HeaderWideView.prototype.template = template;

      return HeaderWideView;

    })(HeaderNarrowView);
  });

}).call(this);

(function() {
  define('templates/products/product',[],function() {
    return function(context) {
      var render;
      render = function() {
        var $c, $e, $o;
        $e = function(text, escape) {
          return ("" + text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#39;').replace(/\//g, '&#47;').replace(/"/g, '&quot;');
        };
        $c = function(text) {
          switch (text) {
            case null:
            case void 0:
              return '';
            case true:
            case false:
              return '' + text;
            default:
              return text;
          }
        };
        $o = [];
        $o.push("<div>\n  <img class='kormapp-product-image' src='" + ($e($c(this.image.mobile_url))) + "'>\n  <p class='kormapp-product-title'>" + ($e($c(this.title))) + "</p>\n  <p class='kormapp-product-in-list-price'>" + ($c(this.money(this.price))) + "</p>\n</div>\n<div class='kormapp-product-quantity' role='kormapp-product-quantity'></div>");
        return $o.join("\n").replace(/\s([\w-]+)='true'/mg, ' $1').replace(/\s([\w-]+)='false'/mg, '').replace(/\s(?:id|class)=(['"])(\1)/mg, "");
      };
      return render.call(context);
    };
  });

}).call(this);

(function() {
  define('templates/products/button_added',[],function() {
    return function(context) {
      var render;
      render = function() {
        var $o;
        $o = [];
        $o.push("<a class='kormapp-in-order kormapp-order-button' href='#777'>\n  <span class='kormapp-to-bucket kormapp-to-bucket-orange'></span>\n  <span class='kormapp-order-button-text'>\n    В ЗАКАЗE\n    <span class='kormapp-cart-item-quantity' role='kormapp-cart-item-quantity'></span>\n    шт\n  </span>\n</a>");
        return $o.join("\n").replace(/\s(?:id|class)=(['"])(\1)/mg, "");
      };
      return render.call(context);
    };
  });

}).call(this);

(function() {
  var __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

  define('views/products/cart_button',['templates/products/button_added', 'helpers/application_helpers'], function(template) {
    var ProductView, _ref;
    return ProductView = (function(_super) {
      __extends(ProductView, _super);

      function ProductView() {
        _ref = ProductView.__super__.constructor.apply(this, arguments);
        return _ref;
      }

      ProductView.prototype.template = template;

      ProductView.prototype.bindings = {
        '@kormapp-cart-item-quantity': 'quantity'
      };

      ProductView.prototype.onRender = function() {
        return this.stickit();
      };

      return ProductView;

    })(Marionette.ItemView);
  });

}).call(this);

(function() {
  define('templates/products/empty_button',[],function() {
    return function(context) {
      var render;
      render = function() {
        var $o;
        $o = [];
        $o.push("<a class='kormapp-order-button' href='#777'>\n  <span class='kormapp-to-bucket kormapp-to-bucket-regular'></span>\n  <span class='kormapp-order-button-text'>В ЗАКАЗ</span>\n</a>");
        return $o.join("\n").replace(/\s(?:id|class)=(['"])(\1)/mg, "");
      };
      return render.call(context);
    };
  });

}).call(this);

(function() {
  var __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

  define('views/products/empty_cart_button',['templates/products/empty_button'], function(template) {
    var EmptyCartButton, _ref;
    return EmptyCartButton = (function(_super) {
      __extends(EmptyCartButton, _super);

      function EmptyCartButton() {
        _ref = EmptyCartButton.__super__.constructor.apply(this, arguments);
        return _ref;
      }

      EmptyCartButton.prototype.template = template;

      return EmptyCartButton;

    })(Marionette.ItemView);
  });

}).call(this);

(function() {
  var __bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; },
    __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

  define('views/products/product',['templates/products/product', 'views/products/cart_button', 'views/products/empty_cart_button', 'helpers/application_helpers'], function(productTemplate, CartButton, EmptyCartButton, Helpers) {
    var ProductView, _ref;
    return ProductView = (function(_super) {
      __extends(ProductView, _super);

      function ProductView() {
        this.showButton = __bind(this.showButton, this);
        this.cartChanged = __bind(this.cartChanged, this);
        _ref = ProductView.__super__.constructor.apply(this, arguments);
        return _ref;
      }

      ProductView.prototype.templateHelpers = function() {
        return Helpers;
      };

      ProductView.prototype.template = productTemplate;

      ProductView.prototype.className = 'kormapp-product-block kormapp-reflection';

      ProductView.prototype.ui = {
        productQuantity: '@kormapp-product-quantity'
      };

      ProductView.prototype.events = {
        click: 'clicked'
      };

      ProductView.prototype.initialize = function(options) {
        this.app = options.app, this.cartItems = options.cartItems;
        return this.listenTo(this.cartItems, 'add remove', this.cartChanged);
      };

      ProductView.prototype.clicked = function(e) {
        e.preventDefault();
        return this.app.vent.trigger('product:click', this.model);
      };

      ProductView.prototype.cartChanged = function(item) {
        if (item.get('product_id') === this.model.id) {
          return this.showButton();
        }
      };

      ProductView.prototype.showButton = function() {
        var item, view;
        if (item = this.app.cart.items.itemOfProduct(this.model)) {
          view = new CartButton({
            model: item
          });
        } else {
          view = new EmptyCartButton();
        }
        return this.buttonRegion.show(view);
      };

      ProductView.prototype.onRender = function() {
        this.buttonRegion = new Marionette.Region({
          el: this.ui.productQuantity
        });
        return this.showButton();
      };

      return ProductView;

    })(Marionette.ItemView);
  });

}).call(this);

(function() {
  var __bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; },
    __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

  define('views/products/products',['views/products/product'], function(ProductView) {
    var ProductsView, _ref;
    return ProductsView = (function(_super) {
      __extends(ProductsView, _super);

      function ProductsView() {
        this.itemViewOptions = __bind(this.itemViewOptions, this);
        _ref = ProductsView.__super__.constructor.apply(this, arguments);
        return _ref;
      }

      ProductsView.prototype.itemView = ProductView;

      ProductsView.prototype.initialize = function(options) {
        return this.app = options.app, options;
      };

      ProductsView.prototype.itemViewOptions = function() {
        return {
          app: this.app,
          cartItems: this.app.cart.items
        };
      };

      return ProductsView;

    })(Marionette.CollectionView);
  });

}).call(this);

(function() {
  define('templates/modal_windows/vendor_page',[],function() {
    return function(context) {
      var render;
      render = function() {
        var $c, $o;
        $c = function(text) {
          switch (text) {
            case null:
            case void 0:
              return '';
            case true:
            case false:
              return '' + text;
            default:
              return text;
          }
        };
        $o = [];
        $o.push("<div class='kormapp-modal-wrapper'>\n  <div class='kormapp-modal-window kormapp-modal-without-alignment'>\n    <div class='kormapp-column kormapp-full'>\n      <h2 class='kormapp-vendor-title' role='kormapp-vendor-title'></h2>\n      <div class='kormapp-vendor-description' role='kormapp-vendor-description'></div>\n      <a class='kormapp-modal-button kormapp-reflection' href='#' role='kormapp-modal-button'>\n        <span class='kormapp-modal-button-text'>OK</span>\n      </a>\n    </div>\n    <div class='kormapp-vendor-footer'>\n      <span class='kormapp-vendor-city' role='kormapp-vendor-city'></span>\n      <span class='kormapp-app-version'>\n        Версия");
        $o.push("        " + $c(this.version));
        $o.push("        \.\n      </span>\n      <span class='kormapp-app-update' role='kormapp-app-update'>\n        Последнее обновление от");
        $o.push("        " + $c(this.lastUpdateAt));
        $o.push("      </span>\n    </div>\n  </div>\n</div>");
        return $o.join("\n").replace(/\s([\w-]+)='true'/mg, ' $1').replace(/\s([\w-]+)='false'/mg, '').replace(/\s(?:id|class)=(['"])(\1)/mg, "");
      };
      return render.call(context);
    };
  });

}).call(this);

(function() {
  var __bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; },
    __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

  define('views/modal_windows/vendor_page',['templates/modal_windows/vendor_page', 'helpers/application_helpers'], function(template, Helpers) {
    var VendorPageView, _ref;
    return VendorPageView = (function(_super) {
      __extends(VendorPageView, _super);

      function VendorPageView() {
        this._update = __bind(this._update, this);
        this._close = __bind(this._close, this);
        _ref = VendorPageView.__super__.constructor.apply(this, arguments);
        return _ref;
      }

      VendorPageView.prototype.template = template;

      VendorPageView.prototype.templateHelpers = function() {
        return Helpers;
      };

      VendorPageView.prototype.initialize = function(_arg) {
        this.version = _arg.version, this.user = _arg.user, this.updateManager = _arg.updateManager;
      };

      VendorPageView.prototype.ui = {
        closeButton: '@kormapp-modal-button',
        updateButton: '@kormapp-app-update',
        vendorDescription: '@kormapp-vendor-description'
      };

      VendorPageView.prototype.bindings = {
        '@kormapp-vendor-title': {
          observe: 'mobile_subject',
          updateMethod: 'html'
        },
        '@kormapp-vendor-description': {
          observe: 'mobile_description',
          updateMethod: 'html'
        },
        '@kormapp-vendor-city': {
          observe: 'city',
          onGet: function(val) {
            return "" + val;
          }
        }
      };

      VendorPageView.prototype.events = {
        'click @ui.updateButton': '_update',
        'tap': '_close'
      };

      VendorPageView.prototype._close = function() {
        var _this = this;
        return setTimeout((function() {
          return _this.close();
        }), 500);
      };

      VendorPageView.prototype.serializeData = function() {
        this.lastUpdateAt = this.user.get('lastUpdateAt');
        if (this.lastUpdateAt != null) {
          this.lastUpdateAt = (new Date(this.lastUpdateAt)).toLocaleDateString();
        } else {
          this.lastUpdateAt = '???';
        }
        return {
          version: this.version,
          lastUpdateAt: this.lastUpdateAt
        };
      };

      VendorPageView.prototype._update = function() {
        if (this.updateManager) {
          return this.updateManager.perform(true);
        }
      };

      VendorPageView.prototype._setScrollableAreaHeight = function() {
        var scrollableHeight;
        scrollableHeight = $(window).height() / 2;
        return this.ui.vendorDescription.css('max-height', scrollableHeight);
      };

      VendorPageView.prototype.onShow = function() {
        return this._setScrollableAreaHeight();
      };

      VendorPageView.prototype.onRender = function() {
        this.$el.hammer();
        return this.stickit();
      };

      return VendorPageView;

    })(Marionette.ItemView);
  });

}).call(this);

(function() {
  define('templates/footer/footer',[],function() {
    return function(context) {
      var render;
      render = function() {
        var $o;
        $o = [];
        $o.push("<div class='kormapp-row-clearfix' role='kormapp-workspace'>\n  <div class='kormapp-column kormapp-delivery-discount kormapp-full kormapp-reflection' role='kormapp-delivery-discount'>\n    <p class='kormapp-footer-offer' role='kormapp-footer-offer'></p>\n    <p class='kormapp-free-delivery' role='kormapp-free-delivery'></p>\n  </div>\n</div>");
        return $o.join("\n").replace(/\s(?:id|class)=(['"])(\1)/mg, "");
      };
      return render.call(context);
    };
  });

}).call(this);

(function() {
  define('templates/footer/_checkout',[],function() {
    return function(context) {
      var render;
      render = function() {
        var $o;
        $o = [];
        $o.push("<div class='kormapp-column kormapp-footer-content kormapp-full kormapp-reflection'>\n  <a class='kormapp-checkout' href='#777' role='kormapp-checkout'>ОФОРМИТЬ ЗАКАЗ</a>\n</div>");
        return $o.join("\n").replace(/\s(?:id|class)=(['"])(\1)/mg, "");
      };
      return render.call(context);
    };
  });

}).call(this);

(function() {
  var __bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; },
    __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

  define('views/footer/footer',['templates/footer/footer', 'templates/footer/_checkout', 'helpers/application_helpers'], function(template, checkoutButtonTemplate, Helpers) {
    var Footer, _ref;
    return Footer = (function(_super) {
      __extends(Footer, _super);

      function Footer() {
        this.hideButton = __bind(this.hideButton, this);
        _ref = Footer.__super__.constructor.apply(this, arguments);
        return _ref;
      }

      Footer.prototype.template = template;

      Footer.prototype.initialize = function(_arg) {
        this.vent = _arg.vent, this.cart = _arg.cart, this.vendor = _arg.vendor;
        this.model = this.vendor;
        this.collection = this.cart.items;
        return this.vent.on('order:created', this.hideButton);
      };

      Footer.prototype.bindings = {
        '@kormapp-footer-offer': {
          observe: 'mobile_footer',
          updateMethod: 'html'
        },
        '@kormapp-free-delivery': {
          observe: 'mobile_delivery',
          updateMethod: 'html'
        }
      };

      Footer.prototype.events = {
        'click @kormapp-checkout': 'checkoutButtonClicked',
        'click @kormapp-delivery-discount': 'emptyButtonClicked'
      };

      Footer.prototype.collectionEvents = {
        'add': 'showCheckoutButton',
        'remove': 'hideButton'
      };

      Footer.prototype.showCheckoutButton = function() {
        return this.$('@kormapp-workspace').html(checkoutButtonTemplate);
      };

      Footer.prototype.hideButton = function() {
        if (this.cart.isEmpty()) {
          return this.$('@kormapp-workspace').html(this.workspaceDOM);
        }
      };

      Footer.prototype.checkoutButtonClicked = function(e) {
        e.preventDefault();
        return this.vent.trigger('checkout:clicked');
      };

      Footer.prototype.emptyButtonClicked = function() {
        return window.navigator.notification.alert(this.vendor.get('mobile_empty_cart_alert'), null, 'Внимание');
      };

      Footer.prototype.onRender = function() {
        this.stickit();
        this.workspaceDOM = this.$('@kormapp-workspace').children().clone();
        if (!this.cart.isEmpty()) {
          return this.showCheckoutButton();
        }
      };

      return Footer;

    })(Marionette.ItemView);
  });

}).call(this);

(function() {
  var __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

  define('controllers/footer',['views/footer/footer'], function(FooterView) {
    var FooterController, _ref;
    return FooterController = (function(_super) {
      __extends(FooterController, _super);

      function FooterController() {
        _ref = FooterController.__super__.constructor.apply(this, arguments);
        return _ref;
      }

      FooterController.prototype.initialize = function(options) {
        this.cart = options.cart, this.app = options.app, this.user = options.user, this.vendor = options.vendor, this.vent = options.vent;
        this.footerView = new FooterView({
          app: this.app,
          cart: this.cart,
          user: this.user,
          vent: this.vent,
          vendor: this.vendor
        });
        return this.app.mainLayout.footerRegion.show(this.footerView);
      };

      return FooterController;

    })(Marionette.Controller);
  });

}).call(this);

(function() {
  var __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

  define('models/order',[],function() {
    var Order, _ref;
    return Order = (function(_super) {
      __extends(Order, _super);

      function Order() {
        _ref = Order.__super__.constructor.apply(this, arguments);
        return _ref;
      }

      return Order;

    })(Backbone.Model);
  });

}).call(this);

(function() {
  define('settings',[],function() {
    var api_url, default_api_url;
    default_api_url = 'http://api.aydamarket.ru';
    api_url = function() {
      return window.kormapp_api_url || default_api_url;
    };
    return {
      routes: {
        bundles_url: function() {
          return api_url() + '/v1/bundles.json';
        },
        orders_url: function() {
          return api_url() + '/v1/orders.json';
        }
      }
    };
  });

}).call(this);

(function() {
  var __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

  define('controllers/make_order',['models/order', 'settings'], function(Order, Settings) {
    var MakeOrderController, _ref;
    return MakeOrderController = (function(_super) {
      __extends(MakeOrderController, _super);

      function MakeOrderController() {
        _ref = MakeOrderController.__super__.constructor.apply(this, arguments);
        return _ref;
      }

      MakeOrderController.prototype.initialize = function(options) {
        return this.app = options.app, this.user = options.user, this.vendor = options.vendor, options;
      };

      MakeOrderController.prototype.perform = function(cart) {
        var order,
          _this = this;
        order = new Order(this.orderAttributes(cart));
        return order.save(null, {
          url: Settings.routes.orders_url(),
          headers: {
            'X-Vendor-Key': this.vendor.get('key')
          },
          success: function(model, response) {
            _this.app.vent.trigger('order:created', response);
            return _this.successAlert(response);
          },
          error: function(model, response) {
            _this.app.vent.trigger('order:failed', response);
            return _this.errorAlert(response);
          }
        });
      };

      MakeOrderController.prototype.errorAlert = function(response) {
        return window.navigator.notification.alert("Заказ не отправлен. " + response.responseText + ". Повторите снова", null, 'Ошибка соединения!');
      };

      MakeOrderController.prototype.successAlert = function(response) {
        var subject, text;
        if (response.message != null) {
          text = response.message.text;
          subject = response.message.subject;
        } else {
          text = "Ваш заказ №" + response.id;
          subject = 'Заказ отправлен';
        }
        return window.navigator.notification.alert(text, null, subject);
      };

      MakeOrderController.prototype.orderAttributes = function(cart) {
        var orderAttributes, u;
        orderAttributes = cart.toJSON();
        u = this.user.toJSON();
        u.phone = u.phone_prefix + u.phone;
        orderAttributes.user = u;
        orderAttributes.items = this.presentCartItems(cart.items);
        return orderAttributes;
      };

      MakeOrderController.prototype.presentCartItems = function(items) {
        var item, _i, _len, _ref1, _results;
        _ref1 = items.toJSON();
        _results = [];
        for (_i = 0, _len = _ref1.length; _i < _len; _i++) {
          item = _ref1[_i];
          _results.push(item = {
            product_id: item.product_id,
            count: item.quantity,
            price: item.total_cost_cents
          });
        }
        return _results;
      };

      return MakeOrderController;

    })(Marionette.Controller);
  });

}).call(this);

(function() {
  var __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

  define('controllers/order',['models/order', 'controllers/make_order'], function(Order, MakeOrderController) {
    var OrderController, _ref;
    return OrderController = (function(_super) {
      __extends(OrderController, _super);

      function OrderController() {
        _ref = OrderController.__super__.constructor.apply(this, arguments);
        return _ref;
      }

      OrderController.prototype.initialize = function(_arg) {
        var _this = this;
        this.app = _arg.app, this.cart = _arg.cart, this.user = _arg.user, this.vendor = _arg.vendor;
        this.makeOrderController = new MakeOrderController({
          app: this.app,
          user: this.user,
          vendor: this.vendor
        });
        return this.app.vent.on('order:checkout', function() {
          return _this.makeOrderController.perform(_this.cart);
        });
      };

      return OrderController;

    })(Marionette.Controller);
  });

}).call(this);

(function() {
  var __bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; },
    __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

  define('controllers/update_manager',['settings', 'helpers/application_helpers'], function(Settings, Helpers) {
    var ProductsUpdaterController, _ref;
    return ProductsUpdaterController = (function(_super) {
      __extends(ProductsUpdaterController, _super);

      function ProductsUpdaterController() {
        this._update = __bind(this._update, this);
        this.perform = __bind(this.perform, this);
        _ref = ProductsUpdaterController.__super__.constructor.apply(this, arguments);
        return _ref;
      }

      ProductsUpdaterController.prototype.initialize = function(_arg) {
        this.profile = _arg.profile, this.user = _arg.user, this.cart = _arg.cart, this.vendor = _arg.vendor, this.categories = _arg.categories, this.products = _arg.products;
      };

      ProductsUpdaterController.prototype.perform = function(interactive) {
        var _this = this;
        console.log('update data');
        return $.ajax({
          url: Settings.routes.bundles_url(),
          headers: this._headers(),
          success: function(data) {
            var _ref1;
            console.log('update success');
            if (interactive) {
              window.navigator.notification.alert("Обновлено продуктов: " + (data != null ? (_ref1 = data.products) != null ? _ref1.length : void 0 : void 0), null, 'Внимание');
            }
            return _this._update(data);
          },
          error: function(e) {
            console.log('update error', e);
            if (interactive) {
              return window.navigator.notification.alert("Ошибка обновления списка продуктов", null, 'Внимание');
            } else {
              return console.log('Ошибка получения списка продуктов с сервера', e);
            }
          }
        });
      };

      ProductsUpdaterController.prototype._update = function(data) {
        console.log('От сервера получены данные для обновления', data);
        this.products.reset(data.products);
        this.products.save();
        this.categories.reset(data.categories);
        if (!this.categories.get(this.profile.get('current_category_id'))) {
          this.profile.set('current_category_id', this.categories.first().id);
        }
        this.vendor.set(data.vendor);
        this.vendor.save();
        this.cart.set('delivery_price', this.vendor.get('delivery_price'));
        this.user.set('lastUpdateAt', Date.now());
        this.user.save();
        if (this.cart.reattachProductsFromCollection(this.products)) {
          return window.navigator.notification.alert("Продавец изменил цены товаров.\nНовая стоимость корзины: " + (Helpers.money_txt(this.cart.getTotalCost())));
        }
      };

      ProductsUpdaterController.prototype._headers = function() {
        return {
          'X-Vendor-Key': this.vendor.get('key')
        };
      };

      return ProductsUpdaterController;

    })(Marionette.Controller);
  });

}).call(this);

(function() {
  var __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

  define('controllers/checkout',[],function() {
    var CheckoutController, _ref;
    return CheckoutController = (function(_super) {
      __extends(CheckoutController, _super);

      function CheckoutController() {
        _ref = CheckoutController.__super__.constructor.apply(this, arguments);
        return _ref;
      }

      CheckoutController.prototype.initialize = function(_arg) {
        var _this = this;
        this.app = _arg.app, this.cart = _arg.cart, this.vendor = _arg.vendor, this.vent = _arg.vent;
        return this.vent.on('checkout:clicked top_check:clicked', function() {
          if (_this.vendor.isPriceValid(_this.cart)) {
            return _this.app.execute('check:show');
          } else {
            return window.navigator.notification.alert(_this.vendor.minimal_alert(), null, 'Заказ не может быть оформлен');
          }
        });
      };

      return CheckoutController;

    })(Marionette.Controller);
  });

}).call(this);

(function() {
  var __bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; };

  define('controllers/modal',[],function() {
    var ModalController;
    return ModalController = (function() {
      function ModalController(_arg) {
        this.modalRegion = _arg.modalRegion, this.vent = _arg.vent;
        this.hide = __bind(this.hide, this);
        this.vent.on('device:backbutton', this.hide);
      }

      ModalController.prototype.show = function(view) {
        view.on('onClose', this.hide);
        return this.modalRegion.show(view);
      };

      ModalController.prototype.hide = function() {
        return this.modalRegion.close();
      };

      return ModalController;

    })();
  });

}).call(this);

(function() {
  define('templates/wide_layout',[],function() {
    return function(context) {
      var render;
      render = function() {
        var $o;
        $o = [];
        $o.push("<div class='kormapp-wide-layout'>\n  <div role='kormapp-header-region'></div>\n  <div class='kormapp-content'>\n    <div class='kormapp-container'>\n      <div class='kormapp-sidebar-column' role='kormapp-sidebar-region'>\n        <div role='kormapp-sidebar-categories-region'></div>\n        <div role='kormapp-sidebar-check-region'></div>\n      </div>\n      <div class='kormapp-products-column' role='kormapp-products-region'></div>\n    </div>\n  </div>\n  <div class='kormapp-footer' role='kormapp-footer-region'></div>\n  <div role='kormapp-modal-region'></div>\n</div>");
        return $o.join("\n").replace(/\s(?:id|class)=(['"])(\1)/mg, "");
      };
      return render.call(context);
    };
  });

}).call(this);

(function() {
  var __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

  define('views/wide_layout',['templates/wide_layout', 'helpers/application_helpers'], function(template, Helpers) {
    var WideLayout, _ref;
    return WideLayout = (function(_super) {
      __extends(WideLayout, _super);

      function WideLayout() {
        _ref = WideLayout.__super__.constructor.apply(this, arguments);
        return _ref;
      }

      WideLayout.prototype.el = '@kormapp-container';

      WideLayout.prototype.template = template;

      WideLayout.prototype.regions = {
        headerRegion: "@kormapp-header-region",
        sidebarRegion: '@kormapp-sidebar-region',
        categories: '@kormapp-sidebar-categories-region',
        checkRegion: "@kormapp-sidebar-check-region",
        products: '@kormapp-products-region',
        footerRegion: "@kormapp-footer-region",
        modalRegion: "@kormapp-modal-region",
        checkInfoRegion: "@kormapp-check-info-region"
      };

      WideLayout.prototype.onRender = function() {
        return this.modalRegion.on('close', function(e) {
          return $('body').scrollTop(0);
        });
      };

      return WideLayout;

    })(Marionette.Layout);
  });

}).call(this);

(function() {
  define('templates/narrow_layout',[],function() {
    return function(context) {
      var render;
      render = function() {
        var $o;
        $o = [];
        $o.push("<div class='kormapp-narrow-layout'>\n  <div role='kormapp-categories-region'></div>\n  <div role='kormapp-header-region'></div>\n  <div class='kormapp-content'>\n    <div class='kormapp-products-column' role='kormapp-products-region'></div>\n  </div>\n  <div class='kormapp-footer' role='kormapp-footer-region'></div>\n  <div role='kormapp-check-region'></div>\n  <div role='kormapp-modal-region'></div>\n</div>");
        return $o.join("\n").replace(/\s(?:id|class)=(['"])(\1)/mg, "");
      };
      return render.call(context);
    };
  });

}).call(this);

(function() {
  var __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

  define('views/narrow_layout',['templates/narrow_layout', 'helpers/application_helpers'], function(template, Helpers) {
    var NarrowLayout, _ref;
    return NarrowLayout = (function(_super) {
      __extends(NarrowLayout, _super);

      function NarrowLayout() {
        _ref = NarrowLayout.__super__.constructor.apply(this, arguments);
        return _ref;
      }

      NarrowLayout.prototype.el = '@kormapp-container';

      NarrowLayout.prototype.template = template;

      NarrowLayout.prototype.regions = {
        headerRegion: "@kormapp-header-region",
        products: "@kormapp-products-region",
        categories: "@kormapp-categories-region",
        footerRegion: "@kormapp-footer-region",
        checkRegion: "@kormapp-check-region",
        modalRegion: "@kormapp-modal-region"
      };

      NarrowLayout.prototype.onRender = function() {
        return this.modalRegion.on('close', function(e) {
          return $('body').scrollTop(0);
        });
      };

      return NarrowLayout;

    })(Marionette.Layout);
  });

}).call(this);

(function() {
  define('templates/categories/category',[],function() {
    return function(context) {
      var render;
      render = function() {
        var $c, $e, $o;
        $e = function(text, escape) {
          return ("" + text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#39;').replace(/\//g, '&#47;').replace(/"/g, '&quot;');
        };
        $c = function(text) {
          switch (text) {
            case null:
            case void 0:
              return '';
            case true:
            case false:
              return '' + text;
            default:
              return text;
          }
        };
        $o = [];
        $o.push("" + $e($c(this.name)));
        return $o.join("\n").replace(/\s([\w-]+)='true'/mg, ' $1').replace(/\s([\w-]+)='false'/mg, '');
      };
      return render.call(context);
    };
  });

}).call(this);

(function() {
  var __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

  define('views/categories/category',['templates/categories/category'], function(categoryTemplate) {
    var CategoryView, _ref;
    return CategoryView = (function(_super) {
      __extends(CategoryView, _super);

      function CategoryView() {
        _ref = CategoryView.__super__.constructor.apply(this, arguments);
        return _ref;
      }

      CategoryView.prototype.template = categoryTemplate;

      CategoryView.prototype.tagName = 'a';

      CategoryView.prototype.className = 'kormapp-category-item';

      CategoryView.prototype.attributes = {
        "href": ""
      };

      CategoryView.prototype.activeClass = 'kormapp-category-item-active';

      CategoryView.prototype.triggers = {
        'click': 'category:click'
      };

      CategoryView.prototype.activate = function() {
        return this.$el.addClass(this.activeClass);
      };

      CategoryView.prototype.deactivate = function() {
        return this.$el.removeClass(this.activeClass);
      };

      return CategoryView;

    })(Marionette.ItemView);
  });

}).call(this);

(function() {
  var __bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; },
    __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

  define('views/categories/category_list',['views/categories/category'], function(CategoryView) {
    var CategoryList, _ref;
    return CategoryList = (function(_super) {
      __extends(CategoryList, _super);

      function CategoryList() {
        this._activateItem = __bind(this._activateItem, this);
        this._selectCategory = __bind(this._selectCategory, this);
        _ref = CategoryList.__super__.constructor.apply(this, arguments);
        return _ref;
      }

      CategoryList.prototype.itemView = CategoryView;

      CategoryList.prototype.className = 'kormapp-categories-list';

      CategoryList.prototype.initialize = function(_arg) {
        var _this = this;
        this.collection = _arg.collection, this.profile = _arg.profile;
        return this.on('itemview:category:click', function(view, _arg1) {
          var model;
          model = _arg1.model;
          return _this._selectCategory(view, model);
        });
      };

      CategoryList.prototype.onRender = function() {
        return this._activateAtInit();
      };

      CategoryList.prototype._selectCategory = function(view, model) {
        this.profile.set('current_category_id', model.id);
        return this._activateItem(view);
      };

      CategoryList.prototype._activateAtInit = function() {
        var _ref1;
        this.currentView = this._getCurrentView();
        return (_ref1 = this.currentView) != null ? _ref1.activate() : void 0;
      };

      CategoryList.prototype._activateItem = function(view) {
        var _ref1, _ref2;
        if (this.currentView !== view) {
          if ((_ref1 = this.currentView) != null) {
            _ref1.deactivate();
          }
          this.currentView = view;
          return (_ref2 = this.currentView) != null ? _ref2.activate() : void 0;
        }
      };

      CategoryList.prototype._getCurrentView = function() {
        var active_category, active_id;
        active_id = this.profile.get('current_category_id');
        active_category = this.collection.get(active_id);
        if (active_category != null) {
          return this.children.findByModel(active_category);
        } else {
          return null;
        }
      };

      return CategoryList;

    })(Marionette.CollectionView);
  });

}).call(this);

(function() {
  var __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

  define('views/categories/category_list_narrow',['views/categories/category_list'], function(CategoryList) {
    var CategoryListNarrow, _ref;
    return CategoryListNarrow = (function(_super) {
      __extends(CategoryListNarrow, _super);

      function CategoryListNarrow() {
        _ref = CategoryListNarrow.__super__.constructor.apply(this, arguments);
        return _ref;
      }

      return CategoryListNarrow;

    })(CategoryList);
  });

}).call(this);

(function() {
  define('templates/pull_down_layout',[],function() {
    return function(context) {
      var render;
      render = function() {
        var $o;
        $o = [];
        $o.push("<div class='kormapp-list-container' role='kormapp-pull-down-view'></div>\n<div class='kormapp-pull-tag' role='kormapp-pull-tag'></div>");
        return $o.join("\n").replace(/\s(?:id|class)=(['"])(\1)/mg, "");
      };
      return render.call(context);
    };
  });

}).call(this);

(function() {
  var __bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; },
    __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

  define('pull_down/layout',['templates/pull_down_layout'], function(template) {
    var PullDownLayout, _ref;
    return PullDownLayout = (function(_super) {
      __extends(PullDownLayout, _super);

      function PullDownLayout() {
        this.setHeight = __bind(this.setHeight, this);
        _ref = PullDownLayout.__super__.constructor.apply(this, arguments);
        return _ref;
      }

      PullDownLayout.prototype.className = 'kormapp-categories-list-narrow';

      PullDownLayout.prototype.template = template;

      PullDownLayout.prototype.regions = {
        holder: '@kormapp-pull-down-view'
      };

      PullDownLayout.prototype.ui = {
        pull: '@kormapp-pull-tag'
      };

      PullDownLayout.prototype.onRender = function() {
        var _this = this;
        this.holder.show(this.options.view);
        return this.listenTo(this.options.view, 'itemview:category:click', function() {
          return _this.trigger('pull-down:hide');
        });
      };

      PullDownLayout.prototype.setHeight = function(height) {
        return this.$el.css('-webkit-transform', "translate3d(0, " + height + "px, 0) scale3d(1,1,1)");
      };

      return PullDownLayout;

    })(Marionette.Layout);
  });

}).call(this);

(function() {
  var __bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; },
    __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

  define('pull_down/controller',[],function() {
    var PullDownController, _ref;
    return PullDownController = (function(_super) {
      __extends(PullDownController, _super);

      function PullDownController() {
        this.clickStopperHide = __bind(this.clickStopperHide, this);
        this.clickStopperShow = __bind(this.clickStopperShow, this);
        this.updateHeight = __bind(this.updateHeight, this);
        this._show = __bind(this._show, this);
        this._hide = __bind(this._hide, this);
        this._toggle = __bind(this._toggle, this);
        this.hammerHandler = __bind(this.hammerHandler, this);
        this.onRender = __bind(this.onRender, this);
        _ref = PullDownController.__super__.constructor.apply(this, arguments);
        return _ref;
      }

      PullDownController.prototype.clickStopperTemplate = '<div class="kormapp-click-stopper"></div>';

      PullDownController.prototype.initialize = function(_arg) {
        this.view = _arg.view, this.workHeight = _arg.workHeight, this.handler = _arg.handler;
        this.setHeight = this.view.setHeight.bind(this.view);
        this._dragged = false;
        this._anim = null;
        this._down = false;
        this._pullDownDistance = 0;
        this.maxHeight = 300;
        return this.listenTo(this.view, 'render', this.onRender);
      };

      PullDownController.prototype.onRender = function() {
        this.view.ui.pull.hammer();
        this.view.ui.pull.on('release dragdown', this.hammerHandler);
        this.view.ui.pull.on('tap', this._toggle);
        return this.listenTo(this.view, 'pull-down:hide', this._hide);
      };

      PullDownController.prototype.hammerHandler = function(ev) {
        switch (ev.type) {
          case 'release':
            if (!this._dragged) {
              return;
            }
            webkitCancelRequestAnimationFrame(this._anim);
            if (this._pullDownDistance >= this.workHeight) {
              this._show();
              if (typeof this.handler === 'function') {
                return this.handler(this);
              }
            } else {
              return this._hide();
            }
            break;
          case 'dragdown':
            this._dragged = true;
            if (!this._anim) {
              this.updateHeight();
            }
            ev.gesture.preventDefault();
            return this._pullDownDistance = _.min([ev.gesture.deltaY, this.maxHeight]);
        }
      };

      PullDownController.prototype._toggle = function() {
        if (this._down) {
          return this._hide();
        } else {
          return this._show();
        }
      };

      PullDownController.prototype._hide = function() {
        this._pullDownDistance = 0;
        this.setHeight(0);
        webkitCancelRequestAnimationFrame(this._anim);
        this._anim = null;
        this._dragged = null;
        this._down = false;
        return this.clickStopperHide();
      };

      PullDownController.prototype._show = function() {
        this.view.$el.addClass('kormapp-slided-down');
        this._dragged = false;
        this.setHeight(this.maxHeight);
        this._down = true;
        return this.clickStopperShow();
      };

      PullDownController.prototype.updateHeight = function() {
        this.setHeight(this._pullDownDistance);
        return this._anim = webkitRequestAnimationFrame(this.updateHeight);
      };

      PullDownController.prototype.clickStopperShow = function() {
        this.clickStopper = $(this.clickStopperTemplate);
        this.view.$el.append(this.clickStopper);
        this.clickStopper.height($(window).height() + this.maxHeight);
        this.clickStopper.width($(window).width());
        return this.clickStopper.one('click', this._hide);
      };

      PullDownController.prototype.clickStopperHide = function() {
        var _this = this;
        return setTimeout((function() {
          _this.view.$el.removeClass('kormapp-slided-down');
          return _this.clickStopper.remove();
        }), 500);
      };

      return PullDownController;

    })(Marionette.Controller);
  });

}).call(this);

(function() {
  var __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

  define('models/user',[],function() {
    'use strict';
    var User, _ref;
    return User = (function(_super) {
      __extends(User, _super);

      function User() {
        _ref = User.__super__.constructor.apply(this, arguments);
        return _ref;
      }

      User.prototype.localStorage = new Backbone.LocalStorage('users');

      User.prototype.defaults = {
        id: 1,
        address: '',
        phone: '',
        phone_prefix: '+7',
        name: '',
        lastUpdateAt: null
      };

      User.prototype.isAllFieldsFilled = function() {
        if (this.get('address') && this.get('phone')) {
          return true;
        }
      };

      return User;

    })(Backbone.Model);
  });

}).call(this);

(function() {
  var __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

  define('models/vendor',['helpers/application_helpers'], function(Helpers) {
    var Vendor, _ref;
    return Vendor = (function(_super) {
      __extends(Vendor, _super);

      function Vendor() {
        _ref = Vendor.__super__.constructor.apply(this, arguments);
        return _ref;
      }

      Vendor.prototype.localStorage = new Backbone.LocalStorage('vendors');

      Vendor.prototype.defaults = {
        key: '!PREDEFINED_KEY',
        mobile_title: 'Доставка<br>пончиков',
        mobile_logo_url: 'kormapp/images/logo.png',
        mobile_subject: 'Доставка пончиков "От Геннадия"',
        mobile_description: 'Мы доставляем быстро, минимальная стоимость заказа от 500 руб.',
        mobile_footer: 'Выберите из списка блюдо на заказ.',
        mobile_delivery: 'Доставка бесплатно от 500 руб.',
        mobile_empty_cart_alert: 'Выберите из списка блюдо на заказ.',
        mobile_minimal_alert: 'Минимальный заказ от 500 руб.'
      };

      Vendor.prototype.minimal_alert = function() {
        return this.get('mobile_minimal_alert');
      };

      Vendor.prototype.isPriceValid = function(cart) {
        return cart.get('total_cost').cents >= this.get('minimal_price').cents;
      };

      return Vendor;

    })(Backbone.Model);
  });

}).call(this);

(function() {
  var __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

  define('models/profile',[],function() {
    var Profile, _ref;
    return Profile = (function(_super) {
      __extends(Profile, _super);

      function Profile() {
        _ref = Profile.__super__.constructor.apply(this, arguments);
        return _ref;
      }

      Profile.prototype.localStorage = new Backbone.LocalStorage('profile');

      Profile.prototype.defaults = {
        id: 1
      };

      Profile.prototype.initialize = function() {
        var _this = this;
        return this.on('change', function() {
          return _this.save();
        });
      };

      return Profile;

    })(Backbone.Model);
  });

}).call(this);

(function() {
  var __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

  define('models/cart_item',[],function() {
    'use strict';
    var CartItem, _ref;
    return CartItem = (function(_super) {
      __extends(CartItem, _super);

      function CartItem() {
        _ref = CartItem.__super__.constructor.apply(this, arguments);
        return _ref;
      }

      CartItem.prototype.defaults = {
        quantity: 1
      };

      CartItem.prototype.initialize = function(_arg) {
        var product;
        product = _arg.product;
        if (product != null) {
          return this.reattachProductFromCollection(product);
        }
      };

      CartItem.prototype.reattachProductFromCollection = function(product) {
        product = this.collection.products.get((product != null ? product.id : void 0) || this.get('product_id'));
        if (product != null) {
          return this.attachProduct(product);
        } else {
          return this.destroy();
        }
      };

      CartItem.prototype.attachProduct = function(product) {
        this.product = product;
        this.set('product_id', this.product.id);
        this.off('change:quantity', this.updateTotalCost);
        this.on('change:quantity', this.updateTotalCost);
        return this.updateTotalCost();
      };

      CartItem.prototype.updateTotalCost = function() {
        var cents;
        cents = this.product.get('price').cents * this.get('quantity');
        return this.set({
          total_cost: {
            cents: cents,
            currency: this.product.get('price').currency
          },
          total_cost_cents: cents
        });
      };

      return CartItem;

    })(Backbone.Model);
  });

}).call(this);

(function() {
  var __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

  define('collections/cart_items',['models/cart_item'], function(CartItem) {
    var CartItems, _ref;
    return CartItems = (function(_super) {
      __extends(CartItems, _super);

      function CartItems() {
        _ref = CartItems.__super__.constructor.apply(this, arguments);
        return _ref;
      }

      CartItems.prototype.model = CartItem;

      CartItems.prototype.localStorage = new Backbone.LocalStorage('cart_items');

      CartItems.prototype.getTotalCost = function() {
        var addup;
        addup = function(memo, item) {
          var _ref1;
          return (((_ref1 = item.get('total_cost')) != null ? _ref1.cents : void 0) || 0) + memo;
        };
        return {
          cents: this.reduce(addup, 0),
          currency: 'RUB'
        };
      };

      CartItems.prototype.getTotalCount = function() {
        var addup;
        addup = function(memo, item) {
          return item.get('quantity') + memo;
        };
        return this.reduce(addup, 0);
      };

      CartItems.prototype.isProductInCart = function(product) {
        return !!this.cartItem(product);
      };

      CartItems.prototype.itemOfProduct = function(product) {
        return this.findWhere({
          product_id: product.id
        });
      };

      return CartItems;

    })(Backbone.Collection);
  });

}).call(this);

(function() {
  var __bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; },
    __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

  define('models/cart',['collections/cart_items', 'helpers/application_helpers'], function(CartItems, Helpers) {
    'use strict';
    var Cart, _ref;
    return Cart = (function(_super) {
      __extends(Cart, _super);

      function Cart() {
        this.updateAggregators = __bind(this.updateAggregators, this);
        _ref = Cart.__super__.constructor.apply(this, arguments);
        return _ref;
      }

      Cart.prototype.initialize = function(data, products) {
        this.items = new CartItems();
        this.items.products = products;
        this.listenTo(this.items, 'add change remove', this.updateAggregators);
        return this.updateAggregators();
      };

      Cart.prototype.fetch = function() {
        return this.items.fetch();
      };

      Cart.prototype.updateAggregators = function() {
        var total_cost;
        total_cost = this.items.getTotalCost();
        return this.set({
          total_cost: total_cost,
          total_count: this.items.getTotalCount(),
          total_cost_cents: total_cost.cents
        });
      };

      Cart.prototype.isEmpty = function() {
        return this.items.length === 0;
      };

      Cart.prototype.getNumberOfItems = function() {
        return this.items.length;
      };

      Cart.prototype.changeQuantity = function(product, quantity) {
        var item;
        item = this.items.itemOfProduct(product);
        item.set('quantity', quantity);
        return item.save();
      };

      Cart.prototype.addProduct = function(product) {
        return this.items.create({
          product: product
        });
      };

      Cart.prototype.removeProduct = function(product) {
        var item;
        item = this.items.itemOfProduct(product);
        if (item != null) {
          return item.destroy();
        }
      };

      Cart.prototype.getTotalCost = function() {
        return this.items.getTotalCost();
      };

      Cart.prototype.reattachProductsFromCollection = function(products) {
        var saved_total_cost;
        saved_total_cost = this.getTotalCost();
        this.items.each(function(ci) {
          return ci.reattachProductFromCollection();
        });
        return saved_total_cost.cents !== this.getTotalCost().cents;
      };

      return Cart;

    })(Backbone.Model);
  });

}).call(this);

(function() {
  var __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

  define('models/product',[],function() {
    var Product, _ref;
    return Product = (function(_super) {
      __extends(Product, _super);

      function Product() {
        _ref = Product.__super__.constructor.apply(this, arguments);
        return _ref;
      }

      Product.prototype.localStorage = new Backbone.LocalStorage('products');

      return Product;

    })(Backbone.Model);
  });

}).call(this);

(function() {
  var __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

  define('collections/products',['models/product'], function(Product) {
    var Products, _ref;
    return Products = (function(_super) {
      __extends(Products, _super);

      function Products() {
        _ref = Products.__super__.constructor.apply(this, arguments);
        return _ref;
      }

      Products.prototype.model = Product;

      Products.prototype.localStorage = new Backbone.LocalStorage('products');

      Products.prototype.save = function() {
        return this.forEach(function(p) {
          return p.save();
        });
      };

      return Products;

    })(Backbone.Collection);
  });

}).call(this);

(function() {
  var __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

  define('models/category',[],function() {
    var Category, _ref;
    return Category = (function(_super) {
      __extends(Category, _super);

      function Category() {
        _ref = Category.__super__.constructor.apply(this, arguments);
        return _ref;
      }

      Category.prototype.localStorage = new Backbone.LocalStorage('categories');

      return Category;

    })(Backbone.Model);
  });

}).call(this);

(function() {
  var __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

  define('collections/categories',['models/category'], function(Category) {
    var Categories, _ref;
    return Categories = (function(_super) {
      __extends(Categories, _super);

      function Categories() {
        _ref = Categories.__super__.constructor.apply(this, arguments);
        return _ref;
      }

      Categories.prototype.model = Category;

      Categories.prototype.localStorage = new Backbone.LocalStorage('categories');

      Categories.prototype.comparator = 'position';

      Categories.prototype.save = function() {
        return this.forEach(function(p) {
          return p.save();
        });
      };

      return Categories;

    })(Backbone.Collection);
  });

}).call(this);

(function() {
  define('controllers/data_repository',['models/user', 'models/vendor', 'models/profile', 'models/cart', 'collections/cart_items', 'collections/products', 'collections/categories'], function(User, Vendor, Profile, Cart, CartItems, ProductsCollection, CategoriesCollection) {
    return function(App, bundle) {
      if (window.localStorage.kormapp_version !== App.version) {
        console.log("Clear localStorage");
        window.localStorage.clear();
        window.localStorage.kormapp_version = App.version;
        if (bundle.vendor.is_demo) {
          _.defer(function() {
            return window.navigator.notification.alert("Это демонстрационное приложение! Заказы не исполняются.", null, 'Внимание!');
          });
        }
      }
      App.vendor = new Vendor();
      App.categories = new CategoriesCollection();
      App.products = new ProductsCollection();
      App.user = new User();
      App.user.fetch();
      if (false && (App.user.get('lastUpdateAt') != null)) {
        App.vendor.fetch();
        App.categories.fetch();
        App.products.fetch();
      } else {
        App.vendor.set(bundle.vendor);
        App.categories.set(bundle.categories);
        App.products.set(bundle.products);
      }
      App.cart = new Cart({}, App.products);
      App.cart.fetch();
      App.cart.set('delivery_price', App.vendor.get('delivery_price'));
      App.profile = new Profile();
      App.profile.fetch();
      if (!App.profile.get('current_category_id')) {
        return App.profile.set('current_category_id', App.categories.first().id);
      }
    };
  });

}).call(this);

(function() {
  define('controllers/reflection',[],function() {
    var ReflectionController;
    return ReflectionController = (function() {
      function ReflectionController() {
        var _this = this;
        $(document).on("touchstart mousedown", '.kormapp-reflection', function(e) {
          var el, _callback;
          el = $(e.currentTarget);
          el.addClass('kormapp-reflection-on');
          _callback = _this.callback.bind(_this, el);
          if (_this._reflection_timeout_id != null) {
            window.clearTimeout(_this._reflection_timeout_id);
          }
          _this._reflection_timeout_id = window.setTimeout(_callback, 2000);
          return el.on("touchend mouseup touchmove mousemove", _callback);
        });
      }

      ReflectionController.prototype.callback = function(el) {
        el.removeClass('kormapp-reflection-on');
        window.clearTimeout(this._reflection_timeout_id);
        return this._reflection_callback = void 0;
      };

      return ReflectionController;

    })();
  });

}).call(this);

(function() {
  var __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

  define('controllers/current_category',[],function() {
    var CurrentCategoryController, _ref;
    return CurrentCategoryController = (function(_super) {
      __extends(CurrentCategoryController, _super);

      function CurrentCategoryController() {
        _ref = CurrentCategoryController.__super__.constructor.apply(this, arguments);
        return _ref;
      }

      CurrentCategoryController.prototype.initialize = function(_arg) {
        var _this = this;
        this.profile = _arg.profile, this.sorted = _arg.sorted;
        return this.listenTo(this.profile, 'change', function() {
          return _this.updateProductsList(_this.profile.get('current_category_id'));
        });
      };

      CurrentCategoryController.prototype.updateProductsList = function(id) {
        return this.sorted.updateFilter({
          category_id: id
        });
      };

      return CurrentCategoryController;

    })(Marionette.Controller);
  });

}).call(this);

(function() {
  define('app',['controllers/cart', 'controllers/check', 'views/header/header_wide', 'views/header/header_narrow', 'views/products/products', 'views/modal_windows/vendor_page', 'controllers/footer', 'controllers/order', 'controllers/update_manager', 'controllers/checkout', 'controllers/modal', 'views/wide_layout', 'views/narrow_layout', 'views/categories/category_list', 'views/categories/category_list_narrow', 'pull_down/layout', 'pull_down/controller', 'views/check/check', 'controllers/data_repository', 'controllers/reflection', 'controllers/current_category'], function(CartController, CheckController, HeaderWideView, HeaderNarrowView, ProductsView, VendorPageView, FooterController, OrderController, UpdateManager, CheckoutController, ModalController, WideLayout, NarrowLayout, CategoryList, CategoryListNarrow, PullDownLayout, PullDownController, CheckView, DataPreloader, Reflection, CurrentCategoryController) {
    var App;
    App = new Marionette.Application;
    App.version = '0.1.33';
    App.addInitializer(function(_arg) {
      var bundle, categoryListView, headerView, pullDownLayout, sorted_products;
      bundle = _arg.bundle;
      App.bundle = bundle;
      console.log("App initialize", Date.now());
      App.isWide = document.body.clientWidth > 992;
      DataPreloader(App, bundle);
      App.updateManager = new UpdateManager({
        user: App.user,
        profile: App.profile,
        cart: App.cart,
        vendor: App.vendor,
        categories: App.categories,
        products: App.products
      });
      App.mainLayout = App.isWide ? new WideLayout() : new NarrowLayout();
      App.mainLayout.render();
      App.modal = new ModalController({
        modalRegion: App.mainLayout.modalRegion,
        vent: App.vent
      });
      new CartController({
        vent: App.vent,
        cart: App.cart,
        modal: App.modal
      });
      new OrderController({
        app: App,
        cart: App.cart,
        user: App.user,
        vendor: App.vendor
      });
      headerView = App.isWide ? new HeaderWideView({
        app: App,
        cart: App.cart,
        vendor: App.vendor
      }) : new HeaderNarrowView({
        app: App,
        cart: App.cart,
        vendor: App.vendor
      });
      headerView.on('logo:clicked', function() {
        return App.modal.show(new VendorPageView({
          version: App.version,
          model: App.vendor,
          user: App.user,
          updateManager: App.updateManager
        }));
      });
      App.mainLayout.headerRegion.show(headerView);
      sorted_products = new Backbone.VirtualCollection(App.products, {
        comparator: 'position',
        filter: {
          category_id: App.profile.get('current_category_id')
        }
      });
      categoryListView = App.isWide ? new CategoryList({
        collection: App.categories,
        profile: App.profile
      }) : new CategoryListNarrow({
        collection: App.categories,
        profile: App.profile
      });
      if (App.categories.length > 1) {
        if (App.isWide) {
          App.mainLayout.categories.show(categoryListView);
        } else {
          pullDownLayout = new PullDownLayout({
            view: categoryListView
          });
          new PullDownController({
            view: pullDownLayout,
            workHeight: headerView.$el.height()
          });
          App.mainLayout.categories.show(pullDownLayout);
        }
      }
      if (App.isWide) {
        App.mainLayout.checkRegion.show(new CheckView({
          app: App,
          user: App.user,
          cart: App.cart,
          vendor: App.vendor,
          modal: App.modal
        }));
      } else {
        new CheckController({
          app: App,
          user: App.user,
          cart: App.cart,
          vendor: App.vendor,
          modal: App.modal
        });
      }
      new CurrentCategoryController({
        profile: App.profile,
        sorted: sorted_products
      });
      App.mainLayout.products.show(new ProductsView({
        app: App,
        collection: sorted_products
      }));
      if (!App.isWide) {
        new FooterController({
          app: App,
          cart: App.cart,
          user: App.user,
          vent: App.vent,
          vendor: App.vendor
        });
      }
      return new CheckoutController({
        app: App,
        cart: App.cart,
        vendor: App.vendor,
        vent: App.vent
      });
    });
    App.on('start', function() {
      var onDeviceReady;
      console.log("Start KormApp " + App.version, Date.now());
      if (App.bundle.update === 'now') {
        App.updateManager.perform();
      }
      onDeviceReady = function() {
        var cordova_ios, ios, ios7, userAgent, _ref, _ref1;
        console.log('onDeviceReady fired');
        if (typeof navigator !== "undefined" && navigator !== null) {
          if ((_ref = navigator.splashscreen) != null) {
            _ref.hide();
          }
        }
        document.addEventListener('backbutton', (function(e) {
          App.vent.trigger('device:backbutton');
          e.preventDefault();
          return e.stopPropagation();
        }), false);
        userAgent = navigator.userAgent;
        ios = userAgent.match(/(iPhone|iPad)/g);
        if (ios) {
          ios7 = userAgent.match(/OS 7/);
        }
        cordova_ios = (_ref1 = window.cordova.platformId) != null ? _ref1.match(/ios/) : void 0;
        if (cordova_ios && ios7) {
          return $('body').addClass('kormapp-body-ios7');
        }
      };
      new Reflection();
      document.addEventListener("deviceready", onDeviceReady, false);
      return console.log("start:finish", Date.now());
    });
    return App;
  });

}).call(this);

