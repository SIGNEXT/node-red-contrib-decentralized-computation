/**
 * Copyright JS Foundation and other contributors, http://js.foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 **/

module.exports = function (RED) {
    "use strict";

    var isUtf8 = require('is-utf8');

    function RegistryNode(n) {
        RED.nodes.createNode(this, n);
        this.topic = n.topic;
        this.qos = n.qos || null;
        this.retain = n.retain;
        this.broker = n.broker;
        this.brokerConn = this.broker !== undefined ? RED.nodes.getNode(this.broker) : null;
        var node = this;
        var chk = /[\+#]/;

        const devices = {};
        let firstTime = true;

        // node.setupMQTT();

        this.predicates = ["node-red"];

        setTimeout(() => {
            node.send({
                payload: devices
            });
            firstTime = false;
        }, 3000);

        this.qos = parseInt(n.qos);
        if (isNaN(this.qos) || this.qos < 0 || this.qos > 2) {
            this.qos = 2;
        }
        this.broker = n.broker;
        this.brokerConn = RED.nodes.getNode(this.broker);
        if (!/^(#$|(\+|[^+#]*)(\/(\+|[^+#]*))*(\/(\+|#|[^+#]*))?$)/.test(this.topic)) {
            return this.warn(RED._("mqtt.errors.invalid-topic"));
        }
        this.datatype = n.datatype || "utf8";
        var node = this;
        if (this.brokerConn) {
            this.status({ fill: "red", shape: "ring", text: "node-red:common.status.disconnected" });
            if (this.topic) {
                node.brokerConn.register(this);
                this.brokerConn.subscribe(this.topic, this.qos, function (topic, payload, packet) {
                    if (node.datatype === "buffer") {
                        // payload = payload;
                    } else if (node.datatype === "base64") {
                        payload = payload.toString('base64');
                    } else if (node.datatype === "utf8") {
                        payload = payload.toString('utf8');
                    } else if (node.datatype === "json") {
                        if (isUtf8(payload)) {
                            payload = payload.toString();
                            try { payload = JSON.parse(payload); }
                            catch (e) { node.error(RED._("mqtt.errors.invalid-json-parse"), { payload: payload, topic: topic, qos: packet.qos, retain: packet.retain }); return; }
                        }
                        else { node.error((RED._("mqtt.errors.invalid-json-string")), { payload: payload, topic: topic, qos: packet.qos, retain: packet.retain }); return; }
                    } else {
                        if (isUtf8(payload)) { payload = payload.toString(); }
                    }
                    var msg = { topic: topic, payload: payload, qos: packet.qos, retain: packet.retain };
                    if ((node.brokerConn.broker === "localhost") || (node.brokerConn.broker === "127.0.0.1")) {
                        msg._topic = topic;
                    }

                    const ip = payload.payload.address;
                    const capabilities = payload.payload.capabilities;
                    const failure = payload.payload.failure || 0;

                    for(const id in devices) {
                        devices[id].new = false;
                    }

                    devices[ip] = {
                        status: 1,
                        failure: failure,
                        memoryErrorNodes: null,
                        capabilities: capabilities,
                        new: !firstTime
                    }

                    !firstTime && node.send({
                        payload: devices
                    });

                }, this.id);
                if (this.brokerConn.connected) {
                    node.status({ fill: "green", shape: "dot", text: "node-red:common.status.connected" });
                }
            }
            else {
                this.error(RED._("mqtt.errors.not-defined"));
            }
            this.on('close', function (removed, done) {
                if (node.brokerConn) {
                    node.brokerConn.unsubscribe(node.topic, node.id, removed);
                    node.brokerConn.deregister(node, done);
                }
            });
        } else {
            this.error(RED._("mqtt.errors.missing-config"));
        }


    }
    RED.nodes.registerType("registry", RegistryNode);
};