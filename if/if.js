module.exports = function (RED) {
  const DeviceHandler = require("devicehandler");

  var operators = {
    eq: function (a, b) {
      return a == b;
    },
    neq: function (a, b) {
      return a != b;
    },
    lt: function (a, b) {
      return a < b;
    },
    lte: function (a, b) {
      return a <= b;
    },
    gt: function (a, b) {
      return a > b;
    },
    gte: function (a, b) {
      return a >= b;
    },
    btwn: function (a, b, c) {
      return (a >= b && a <= c) || (a <= b && a >= c);
    },
    true: function (a) {
      return a === true;
    },
    false: function (a) {
      return a === false;
    },
    null: function (a) {
      return typeof a == "undefined" || a === null;
    },
    nnull: function (a) {
      return typeof a != "undefined" && a !== null;
    },
  };

  let pythonOperators = {
    eq: "a == b",
    neq: "a != b",
    lt: "a < b",
    lte: "a <= b",
    gt: "a > b",
    gte: "a >= b",
    btwn: "(a >= b and a <= c)  or (a <= b and a >= c)",
    true: "a == True",
    false: "a == False",
    null: "a == None",
    nnull: "a != None",
  };

  var _maxKeptCount;

  function getMaxKeptCount() {
    if (_maxKeptCount === undefined) {
      var name = "nodeMessageBufferMaxLength";
      if (Object.prototype.hasOwnProperty.call(RED.settings, "name")) {
        _maxKeptCount = RED.settings[name];
      } else {
        _maxKeptCount = 0;
      }
    }
    return _maxKeptCount;
  }

  function getProperty(node, msg, done) {
    if (node.propertyType === "jsonata") {
      RED.util.evaluateJSONataExpression(node.property, msg, (err, value) => {
        if (err) {
          done(RED._("if.errors.invalid-expr", { error: err.message }));
        } else {
          done(undefined, value);
        }
      });
    } else {
      RED.util.evaluateNodeProperty(
        node.property,
        node.propertyType,
        node,
        msg,
        (err, value) => {
          if (err) {
            done(undefined, undefined);
          } else {
            done(undefined, value);
          }
        }
      );
    }
  }

  function getV1(node, msg, rule, hasParts, done) {
    if (rule.vt === "prev") {
      return done(undefined, node.previousValue);
    } else if (rule.vt === "jsonata") {
      var exp = rule.v;
      if (rule.t === "jsonata_exp") {
        if (hasParts) {
          exp.assign("I", msg.parts.index);
          exp.assign("N", msg.parts.count);
        }
      }
      RED.util.evaluateJSONataExpression(exp, msg, (err, value) => {
        if (err) {
          done(RED._("if.errors.invalid-expr", { error: err.message }));
        } else {
          done(undefined, value);
        }
      });
    } else if (rule.vt === "json") {
      done(undefined, "json"); // TODO: ?! invalid case
    } else if (rule.vt === "null") {
      done(undefined, "null");
    } else {
      RED.util.evaluateNodeProperty(
        rule.v,
        rule.vt,
        node,
        msg,
        function (err, value) {
          if (err) {
            done(undefined, undefined);
          } else {
            done(undefined, value);
          }
        }
      );
    }
  }

  function getV2(node, msg, rule, done) {
    var v2 = rule.v2;
    if (rule.v2t === "prev") {
      return done(undefined, node.previousValue);
    } else if (rule.v2t === "jsonata") {
      RED.util.evaluateJSONataExpression(rule.v2, msg, (err, value) => {
        if (err) {
          done(RED._("if.errors.invalid-expr", { error: err.message }));
        } else {
          done(undefined, value);
        }
      });
    } else if (typeof v2 !== "undefined") {
      RED.util.evaluateNodeProperty(
        rule.v2,
        rule.v2t,
        node,
        msg,
        function (err, value) {
          if (err) {
            done(undefined, undefined);
          } else {
            done(undefined, value);
          }
        }
      );
    } else {
      done(undefined, v2);
    }
  }

  function applyRule(node, msg, property, state, done) {
    var rule = node.rules[state.currentRule];
    var v1, v2;

    getV1(node, msg, rule, state.hasParts, (err, value) => {
      if (err) {
        return done(err);
      }
      v1 = value;
      getV2(node, msg, rule, (err, value) => {
        if (err) {
          return done(err);
        }
        v2 = value;

        const result = operators[rule.t](
          property,
          v1,
          v2,
          rule.case,
          msg.parts
        );

        if (result) {
          state.onward.push(msg);
          state.elseflag = false;
        } else {
          state.onward.push(null);
        }
        done(undefined, state.currentRule < node.rules.length - 1, result);
      });
    });
  }

  function applyRules(node, msg, property, state, result, done) {
    if (!state) {
      state = {
        currentRule: 0,
        elseflag: true,
        onward: [],
        hasParts:
          Object.prototype.hasOwnProperty.call(msg, "parts") &&
          Object.prototype.hasOwnProperty.call(msg, "id") &&
          Object.prototype.hasOwnProperty.call(msg, "index"),
      };
    }
    applyRule(node, msg, property, state, (err, hasMore, newResult) => {
      if (err) {
        return done(err);
      }
      if (hasMore) {
        state.currentRule++;
        applyRules(node, msg, property, state, newResult && result, done);
      } else {
        node.previousValue = property;
        done(undefined, state.onward, result && newResult);
      }
    });
  }

  function IfNode(n) {
    RED.nodes.createNode(this, n);
    this.rules = n.rules || [];
    this.property = n.property;
    this.propertyType = n.propertyType || "msg";
    this.micropythonCode = n.micropythonCode || "";

    this.predicates = n.predicates.length === 0 ? [] : n.predicates.split(" ");
    this.priorities = n.priorities.length === 0 ? [] : n.priorities.split(" ");

    if (this.propertyType === "jsonata") {
      try {
        this.property = RED.util.prepareJSONataExpression(this.property, this);
      } catch (err) {
        this.error(RED._("if.errors.invalid-expr", { error: err.message }));
        return;
      }
    }

    this.checkall = n.checkall || "true";
    this.previousValue = null;
    var node = this;
    var valid = true;
    var repair = n.repair;
    var needsCount = repair;

    this.broker = n.broker || this.brokerUrl;
    this.brokerConn =
      this.broker !== undefined ? RED.nodes.getNode(this.broker) : null;
    node.brokerConn && node.brokerConn.register(node);

    for (var i = 0; i < this.rules.length; i += 1) {
      var rule = this.rules[i];
      if (!rule.vt) {
        if (!isNaN(Number(rule.v))) {
          rule.vt = "num";
        } else {
          rule.vt = "str";
        }
      }

      if (rule.vt === "num") {
        if (!isNaN(Number(rule.v))) {
          rule.v = Number(rule.v);
        }
      }
    }

    if (typeof rule.v2 !== "undefined") {
      if (!rule.v2t) {
        if (!isNaN(Number(rule.v2))) {
          rule.v2t = "num";
        } else {
          rule.v2t = "str";
        }
      }
      if (rule.v2t === "num") {
        rule.v2 = Number(rule.v2);
      }
    }
    if (!valid) {
      return;
    }

    var pendingCount = 0;
    var pendingId = 0;
    var pendingIn = {};

    function addMessageToGroup(id, msg, parts) {
      if (!(id in pendingIn)) {
        pendingIn[id] = {
          count: undefined,
          msgs: [],
          seq_no: pendingId++,
        };
      }
      var group = pendingIn[id];
      group.msgs.push(msg);
      pendingCount++;
      var max_msgs = getMaxKeptCount();
      if (max_msgs > 0 && pendingCount > max_msgs) {
        clearPending();
        node.error(RED._("if.errors.too-many"), msg);
      }
      if (Object.prototype.hasOwnProperty.call(parts, "count")) {
        group.count = parts.count;
      }
      return group;
    }

    function drainMessageGroup(msgs, count, done) {
      var msg = msgs.shift();
      msg.parts.count = count;
      processMessage(msg, false, (err) => {
        if (err) {
          done(err);
        } else {
          if (msgs.length === 0) {
            done();
          } else {
            drainMessageGroup(msgs, count, done);
          }
        }
      });
    }
    function addMessageToPending(msg, done) {
      var parts = msg.parts;
      // We've already checked the msg.parts has the require bits
      var group = addMessageToGroup(parts.id, msg, parts);
      var msgs = group.msgs;
      var count = group.count;
      var msgsCount = msgs.length;
      if (count === msgsCount) {
        // We have a complete group - send the individual parts
        drainMessageGroup(msgs, count, function (err) {
          node.log(err);
          pendingCount -= msgsCount;
          delete pendingIn[parts.id];
          done();
        });
        return;
      }
      done();
    }

    function processMessage(msg, checkParts, done) {
      var hasParts =
        Object.prototype.hasOwnProperty.call(msg, "parts") &&
        Object.prototype.hasOwnProperty.call(msg, "id") &&
        Object.prototype.hasOwnProperty.call(msg, "index");

      if (needsCount && checkParts && hasParts) {
        addMessageToPending(msg, done);
      } else {
        getProperty(node, msg, (err, property) => {
          if (err) {
            node.warn(err);
            done();
          } else {
            applyRules(
              node,
              msg,
              property,
              undefined,
              true,
              (err, onward, result) => {
                if (err) {
                  node.warn(err);
                } else {
                  const newMsg = { ...msg, payload: result };
                  node.send(newMsg);
                }
                done();
              }
            );
          }
        });
      }
    }

    function clearPending() {
      pendingCount = 0;
      pendingId = 0;
      pendingIn = {};
    }

    var pendingMessages = [];
    var handlingMessage = false;
    var processMessageQueue = function (msg) {
      if (msg) {
        // A new message has arrived - add it to the message queue
        pendingMessages.push(msg);
        if (handlingMessage) {
          // The node is currently processing a message, so do nothing
          // more with this message
          return;
        }
      }
      if (pendingMessages.length === 0) {
        // There are no more messages to process, clear the active flag
        // and return
        handlingMessage = false;
        return;
      }

      // There are more messages to process. Get the next message and
      // start processing it. Recurse back in to check for any more
      var nextMsg = pendingMessages.shift();
      handlingMessage = true;
      processMessage(nextMsg, true, (err) => {
        if (err) {
          node.error(err, nextMsg);
        }
        processMessageQueue();
      });
    };

    this.generateCode = true;
    const inputTopic = `${node.id.replace(".", "")}_input`;
    this.deviceHandler = new DeviceHandler(
      node,
      this.brokerConn,
      generateMicropythonCode(this.property, this.rules)
    );
    this.deviceHandler.setProxyCallback(sendReading);
    // this.deviceHandler.setLocalCallback(handleFailure);

    this.on("input", function (msg) {
      const status = this.deviceHandler.getStatus();
      if (status === "proxy" || status === "remote") {
        msg.payload = { ...msg };
        msg.topic = inputTopic;
        this.brokerConn.publish(msg);
      } else {
        processMessageQueue(msg);
      }
    });

    this.on("close", function () {
      clearPending();
    });

    function sendReading(msg) {
      node.send(msg);
    }

    function pythonParameters(values) {
      if (values.length === 0) return "";
      else if (values.length === 1)
        return `, b = ${values[0] === "" ? '""' : values[0]}`;
      else
        return `, b = ${values[0] === "" ? '""' : values[0]}, c = ${
          values[1] === "" ? '""' : values[1]
        }`;
    }

    function typeConverter(type) {
      if (type === "str") return "a = str(a)";
      else if (type === "num") return "a = int(a)";
    }

    function generateMicropythonCode(property, rules) {
      const textId = node.id.replace(".", "");
      let code = "";

      // const inputTopic = node.inputTopics.length > 0 ? node.inputTopics[0] : undefined;
      const outputTopics = node.wires
        .map((inner) => inner.map((n) => `${n.replace(".", "")}_input`))
        .flat();

      let ifBlock = ``;
      let rulesBlock = ``;

      for (let i = 0; i < rules.length; i++) {
        let valuesRule = Object.keys(rules[i])
          .filter((k) => {
            return k.indexOf("v") === 0 && k.indexOf("t") === -1;
          })
          .map((k) => rules[i][k]);

        const ifRules = `def if_rule_${textId}_${i}(a${pythonParameters(
          valuesRule
        )}):\n    ${typeConverter(rules[i].vt)}\n    return ${
          pythonOperators[rules[i].t]
        }\n`;

        rulesBlock +=
          i == 0
            ? `if_rule_${textId}_${i}(a)`
            : ` and if_rule_${textId}_${i}(a)`;
        ifBlock += ifRules;
      }

      ifBlock += `def if_function_${textId}(a):\n    res = ${rulesBlock}\n    return '%s' % res`;

      code = `\ninput_topics = ["${inputTopic}"]
output_topics_${textId} = [${outputTopics.map((a) => `"${a}"`)}]
property_${textId} = "${property}"

${ifBlock}

def get_property_value_${textId}(msg):
    properties = property_${textId}.split(".")
    payload = ujson.loads(msg)

    for property in properties:
        try:
            payload = ujson.loads(payload)
        except:
            pass
        try:
            if payload[property]:
                payload = payload[property]
            else:
                break
        except:
            break
    return payload

def on_input_${textId}(topic, msg, retained):
    msg = get_property_value_${textId}(msg)
    res = if_function_${textId}(msg)
    res = dict(
        payload=str(res),
        device_id=client_id,
        node_id=node_id
    )
    loop = asyncio.get_event_loop()
    loop.create_task(on_output(ujson.dumps(res), output_topics_${textId}))
    return\n`;

      return code;
    }
  }

  RED.nodes.registerType("if", IfNode);
};
