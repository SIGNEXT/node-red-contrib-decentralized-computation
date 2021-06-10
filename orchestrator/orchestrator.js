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

    const axios = require('axios');

    function OrchestratorNode(n) {
        RED.nodes.createNode(this, n);
        this.topic = n.topic;
        this.qos = n.qos || null;
        this.retain = n.retain;
        this.broker = n.broker || this.brokerUrl;
        this.brokerConn = this.broker !== undefined ? RED.nodes.getNode(this.broker) : null;
        var node = this;
        var chk = /[\+#]/;

        const start = Date.now()

        const nodeAssignment = {};
        let devices = {};
        let assigning = false;
        let ranks = {};

        this.predicates = ["node-red"]

        let doLocalDistribution = true;

        this.on("input", async function (msg, done) {
            try {
                const newDevices = RED.util.getMessageProperty(msg, "payload");
                delete newDevices._msgid;

                if (equalDevices(newDevices)) {
                    return;
                }

                doLocalDistribution = false;

                const nodes = node._flow.activeNodes;
                const changes = {};

                for (const id in newDevices) {
                    // if a device announced itself after a failure
                    // it might be related to "out of memory" errors
                    if (newDevices[id].failure === 1 && devices[id]) {
                        newDevices[id].failure = 0;
                        newDevices[id].memoryErrorNodes = nodeAssignment[id].nodes.length;
                        if (nodeAssignment[id]) nodeAssignment[id].nodes = [];
                    }

                    // if the device was not updated, maintain the same status
                    if (devices[id] && !newDevices[id].new) {
                        newDevices[id].status = devices[id].status;
                    }

                    // if the device was updated, make it active and 
                    // delete previous assignment
                    if (newDevices[id].new) {
                        changes[id] = { status: 1, nodes: [] }
                    }

                    newDevices[id].failure = 0;

                    newDevices[id].timestamp = Date.now()
                    newDevices[id].alive = true;
                }

                devices = { ...newDevices };

                await distributeFlow(nodes, changes);
                // setupPing();
            } catch (err) {
                done(JSON.stringify(err));
            }
        });

        if (this.brokerConn && this.brokerConn.connected) {
            node.status({ fill: "green", shape: "dot", text: "node-red:common.status.connected" });
        }

        node.brokerConn && node.brokerConn.register(node);
        this.on('close', function (done) {
            node.brokerConn.deregister(node, done);
        });

        setUpPing();

        sendTelemetryData();

        try {
            node.brokerConn.subscribe("/failure/+", 2, async (topic, payload, packet) => {

                while (assigning) {
                    await sleep(500);
                }

                const deviceId = topic.substring(topic.lastIndexOf('/') + 1);

                if (devices.hasOwnProperty(deviceId)) {

                    // if it was already marked as failed, ignore
                    if (devices[deviceId].status === 0) {
                        return;
                    }

                    devices[deviceId].status = 0;
                }

                // if the device that died has no associated nodes, we do not need to re-orquestrate
                if (nodeAssignment.hasOwnProperty(deviceId)) {
                    nodeAssignment[deviceId].status = 0;
                    if (nodeAssignment[deviceId].nodes.length === 0) {
                        return;
                    }
                    nodeAssignment[deviceId].nodes = [];
                } else {
                    return;
                }

                const nodes = node._flow.activeNodes;
                const changes = {}
                distributeFlow(nodes, changes);
            });
        } catch (e) {
            console.log(e);
        }


        setTimeout(() => {
            console.log(doLocalDistribution)
            if (doLocalDistribution) {
                const nodes = node._flow.activeNodes;
                const changes = {}
                distributeFlow(nodes, changes);
            }
        }, 5000);

        /**
         * Verifies if the new devices received are repeated, meaning that no 
         * changes happened to their state. This fixes the problem of receiving repeated
         * state and redoing the orchestration when nothing as changed
         * 
         * @param {*} newDevices 
         */
        function equalDevices(newDevices) {
            if (Object.keys(newDevices).length !== Object.keys(devices).length ||
                Object.keys(newDevices).sort().join(",") !== Object.keys(devices).sort().join(",")) return false;

            for (const id in devices) {
                if (newDevices[id].new && newDevices[id].status !== devices[id].status) return false;
                if (newDevices[id].new && newDevices[id].failure !== devices[id].failure) return false;
                if (newDevices[id].new && newDevices[id].capabilities.sort().join(",") !== devices[id].capabilities.sort().join(",")) return false;
            }

            return true;
        }

        async function sendRank(address) {
            let tmpRanks = {};

            for (const node in ranks) {
                tmpRanks[node] = {};
                tmpRanks[node].devices = ranks[node].map((entry, idx) => { return { id: entry.id, order: idx } });
                tmpRanks[node].alive = true;
                tmpRanks[node].timestamp = Date.now()
            }

            axios({
                method: 'POST',
                url: `http://server:8080/assignment/${Date.now()}`,
                data: tmpRanks
            });

            axios({
                method: 'POST',
                url: `http://${address}/rank`,
                data: tmpRanks,
                headers: {
                    "Content-Type": "application/json"
                }
            }).then(res => {
                // node.log(`SUCCESS in sending rank to device ${address}: Status ${res.status}`);
                return { id: address, status: res.status };
            }).catch(err => {
                // node.log(`ERROR in sending rank to device ${address}: Status ${err.status}`);
                return { id: address }
            })

        }

        /**
         * [MINE]
         * 
         * Returns the best device to run a specific node, based on their tags simalirities and available
         * resources in the devices.
         * 
         * @param {*} devices available devices in the network
         * @param {*} node node from the flow
         */
        function getBestDevice(availableDevices, flowNode) {
            const nodePredicates = flowNode.predicates;
            const nodePriorities = flowNode.priorities;

            let bestMatchIndex = 0;
            let bestDevice = null;

            ranks[flowNode.id] = [];

            for (const id in availableDevices) {
                const device = availableDevices[id];

                if (device.status !== 1 || (nodeAssignment[id] && nodeAssignment[id].status !== 1)) continue;

                // Ignores if the number of nodes assigned to the device with a new one is
                // equal or greater than a previous assignment that resulted in memory error
                if (nodeAssignment[id] && device.memoryErrorNodes && (nodeAssignment[id].nodes.length + 1) >= device.memoryErrorNodes) continue;

                // Filter device capabilities to check if the device complies with the 
                // node predicates, which are requirements that cannot be violated
                const predicateIntersection = nodePredicates.filter(tag => device.capabilities.includes(tag));

                // Ignores if there is no intersection or the intersection
                // does not contain all the tags from the node. Node-red is the default
                if (predicateIntersection.length < nodePredicates.length) continue;

                // Filter device capabilities to check if the device has any priority
                // requested by the node, which makes the device more attractive for assignment
                const prioritiesIntersection = nodePriorities.filter(tag => device.capabilities.includes(tag));
                const prioritiesIndex = prioritiesIntersection.length === 0 ? 0 : (prioritiesIntersection.length / nodePriorities.length);

                // Nodes with less nodes assigned, more priorities complied and 
                // more specific intersections have a better match index
                const nrNodes = nodeAssignment[id] ? nodeAssignment[id].nodes.length : 0;
                const matchIndex = prioritiesIndex * 0.5 +
                    (1 / (nrNodes + 1)) * 0.4 +
                    (predicateIntersection.length / device.capabilities.length) * 0.1;

                ranks[flowNode.id].push({ id, matchIndex });

                if (matchIndex > bestMatchIndex) {
                    bestMatchIndex = matchIndex;
                    bestDevice = id;
                }
            }

            ranks[flowNode.id].sort((a, b) => b.matchIndex - a.matchIndex);

            return bestDevice;
        }

        /**
         * [MINE]
         * 
         * Distributes the nodes of the flow among the available devices, in an efficient way. 
         * If there was changes in the devices, the distribution is remade in order to maximize 
         * efficiency and the operability of the flow.
         * 
         * @param {*} nodes nodes of the flow
         * @param {*} changes changes in the devices
         */
        async function distributeFlow(nodes, changes) {
            if (Object.keys(nodes).length === 0) {
                assigning = false;
                return;
            }
            assigning = true;

            node.log(`Starting flow distribution`);

            // Clean previous assignments in the devices
            for (const id in devices) {
                devices[id].nodes = [];
            }

            for (const id in nodeAssignment) {
                nodeAssignment[id].nodes = [];
            }

            if (changes && Object.keys(changes).length > 0 && nodeAssignment) {
                // Merge devices with changes, so that the devices information is updated
                for (const id in nodeAssignment) {
                    const changedDevice = changes[id];
                    if (changedDevice) {
                        devices[id] = { ...devices[id], ...changedDevice };
                        nodeAssignment[id] = { ...nodeAssignment[id], ...changedDevice };
                    }
                    nodeAssignment[id].nodes = [];
                }
            }

            const assignedNodes = [];

            // Assign each node to a device matching the tags
            Object.entries(nodes).forEach(async ([k, flowNode]) => {

                if (!flowNode.inputTopics)
                    flowNode.inputTopics = ""

                if (!flowNode.outputTopics)
                    flowNode.outputTopics = ""

                if (!flowNode.predicates)
                    flowNode.predicates = []

                if (!flowNode.priorities)
                    flowNode.priorities = []

                if (!flowNode.generateCode)
                    flowNode.generateCode = false;

                if (flowNode.type === "mqtt-broker" || flowNode.type === "tab" || flowNode.type === "registry") {
                    return;
                }
                if (flowNode.id === node.id) {
                    return;
                }
                if (flowNode.type.includes("subflow") ||
                    (!flowNode.noWiresType && flowNode.inputTopics.length === 0 && flowNode.outputTopics.length === 0)) {
                }

                // If node does not have a code generator, it only runs in node-red
                if (!flowNode.generateCode) {
                    if (nodeAssignment["node-red"]) {
                        if (!nodeAssignment["node-red"].nodes.find(n => n.id === flowNode.id)) {
                            nodeAssignment["node-red"].nodes.push(extractInfo(flowNode));
                        }
                    } else {
                        nodeAssignment["node-red"] = {
                            status: 1,
                            nodes: [extractInfo(flowNode)]
                        }
                    }
                    return;
                }

                const deviceId = getBestDevice(devices, flowNode);

                if (deviceId) {

                    assignedNodes.push(flowNode.id)

                    // Save this configuration in the current configuration object
                    if (nodeAssignment[deviceId] && nodeAssignment[deviceId].nodes.filter(n => n.id === flowNode.id).length === 0) {
                        nodeAssignment[deviceId].nodes.push(extractInfo(flowNode));
                    } else if (!nodeAssignment[deviceId]) {
                        nodeAssignment[deviceId] = {
                            status: 1,
                            capabilities: devices[deviceId].capabilities,
                            nodes: [extractInfo(flowNode)]
                        }
                    }
                }
                else {
                    // If there is no possibility to comply with the predicate of the node
                    // an error should be thrown since the assignment is not possible
                    if (flowNode.predicates.length > 0 && !flowNode.predicates.includes("node-red")) {
                        node.error(`Predicates in node ${flowNode.id} cannot be satisfied.`);
                        // throw new Error(`Predicates in node ${node.type} ${node.id} cannot be satisfied.`);
                    }

                    // Setup local MQTT because the node will be executed locally
                    if (nodeAssignment["node-red"]) {
                        if (!nodeAssignment["node-red"].nodes.find(n => n.id === flowNode.id)) {
                            nodeAssignment["node-red"].nodes.push(extractInfo(flowNode));
                        }
                    } else {
                        nodeAssignment["node-red"] = {
                            status: 1,
                            nodes: [extractInfo(flowNode)]
                        }
                    }
                }
            });

            // Remove previous assignment to devices that are not active
            for (const id in nodeAssignment) {
                if (nodeAssignment[id].status === 0 && nodeAssignment[id].nodes.length > 0) {
                    nodeAssignment[id].nodes = [];
                }
            }

            // for (const id in nodeAssignment) {
            //     console.log("ID: ", id);
            //     nodeAssignment[id].nodes.forEach(node => {
            //         console.log("\tNode type: ", node.type)
            //     });
            // }

            for (const deviceId in devices) {
                // if there is a device that has no nodes associated with it,must redirect the alive message to the failure topic
                // console.log(nodeAssignment[id].nodes.length,devices[id].status)
                if (!nodeAssignment.hasOwnProperty(deviceId)
                    || !nodeAssignment[deviceId].nodes
                    || nodeAssignment[deviceId].nodes.length === 0) {

                    console.log("Subscribing to alive/", deviceId);
                    node.brokerConn.subscribe(`alive/${deviceId}`, 1, (topic, payload, packet) => {

                        payload = JSON.parse(payload);

                        if (!devices[deviceId].status) {
                            console.log(`Received LTW from an already dead device ${topic}`)
                            return;
                        }

                        if (payload === "0" || payload === 0) {
                            const msg = {
                                topic: `/failure/${deviceId}`,
                                qos: 1,
                                msg: "",
                                retain: 1
                            }
                            node.brokerConn.unsubscribe(`alive/${deviceId}`);
                            node.brokerConn.publish(msg);
                        }
                    })
                }
            }

            const nodes_arr = Object.entries(nodes);
            const promises = [];

            for (let i = 0; i < nodes_arr.length; i++) {
                const entry = nodes_arr[i];
                const id = entry[0];
                const flowNode = entry[1];

                if (flowNode.type === 'orchestrator' || flowNode.type === 'registry' || !flowNode.generateCode) {
                    continue;
                }

                let mode = "remote";

                // if the node has no device associated, it must operate on local.
                if (!assignedNodes.find(el => el === flowNode.id)) {
                    mode = "local";
                    const msg = {
                        topic: `node/${flowNode.id}`.replace(".", ""),
                        payload: { device: null, mode },
                    }
                    promises.push(node.brokerConn.publish(msg, () => { }));
                } else {
                    // in theory, a mqtt-out device will never need to send the information back to the node
                    if (flowNode.type != 'mqtt-out') {
                        // flowNode.wires[0].forEach(output => {
                        //     output.forEach(device => {
                        if (flowNode.wires[0]) {
                            flowNode.wires[0].forEach(device => {
                                const nextNode = nodes_arr.find(el => el[1].id === device);
                                // if any of the nodes attached to its output cannot generate code or are not assigned to a device
                                // this node cannot run on remote node,must send message through node-red events
                                if (!nextNode[1].generateCode) {
                                    mode = "proxy";
                                }
                                if (!assignedNodes.find(el => el === nextNode[1].id)) {
                                    mode = "proxy";
                                }
                            })
                        }
                        // });
                    }

                    if (ranks[flowNode.id].length > 0) {
                        const device = ranks[flowNode.id][0];
                        if (device) {
                            const msg = {
                                topic: `node/${flowNode.id}`.replace(".", ""),
                                payload: { device, mode },
                            }
                            promises.push(node.brokerConn.publish(msg, () => { }));
                        }
                    }
                }
            }

            await Promise.all(promises)

            for (const id in devices) {
                sendRank(id);
            }


            // if (Object.keys(nodeAssignment).length > 0) {
            //     axios({
            //         method: 'POST',
            //         url: `http://server:8080/assignment/${Date.now()}`,
            //         data: nodeAssignment
            //     });
            // }

            assigning = false;
            return;
        }

        function setUpPing() {
            setInterval(() => {
                const msg = {
                    topic: "ping/node-red",
                    qos: 1,
                    payload: { deviceId: "node-red" }
                };
                try {
                    node.brokerConn.publish(msg);
                } catch (e) {
                    console.log("Error");
                }
            }, 1 * 1000);
        }

        function sendTelemetryData() {
            setInterval(() => {

                const telemetry_msg = {
                    topic: "telemetry/node-red/uptime",
                    qos: 0,
                    payload: `${Date.now() - start}`
                }

                let payload = {
                    nodes: "",
                    nr: "0"
                };

                if (nodeAssignment["node-red"]) {
                    payload = {
                        nodes: nodeAssignment["node-red"].nodes.map(n => n.id).join() || 0,
                        nr: `${nodeAssignment["node-red"].nodes.length}`
                    }
                }

                const nodes_msg = {
                    topic: "telemetry/node-red/nodes",
                    qos: 0,
                    payload
                }

                try {
                    node.brokerConn.publish(telemetry_msg);
                    node.brokerConn.publish(nodes_msg);
                } catch (e) {
                    console.log("Error");
                }
            }, 5 * 1000);
        }

        function sleep(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }

        function extractInfo(node) {
            return {
                id: node.id,
                type: node.type,
                predicates: node.predicates,
                priorities: node.priorities,
                name: node.name
            }
        }

    }
    RED.nodes.registerType("orchestrator", OrchestratorNode);
};
