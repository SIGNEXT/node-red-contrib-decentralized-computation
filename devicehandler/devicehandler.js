const axios = require('axios');

class DeviceHandler {

    constructor(node, brokerConn, code) {
        this.node = node;
        this.brokerConn = brokerConn;
        this.id = node.id;
        this.textId = this.id.replace(".", "")
        this.device = null;
        this.status = "proxy";
        this._proxyCallback = () => { };
        this._deviceDeadCallback = () => { };
        this._localCallback = () => { };
        this.nodeCode = code;
        this.proxyTopic = `${this.textId}_proxy`
        this.outputTopics = this.node.wires.map(inner => inner.map(n => `${n.replace(".", "")}_output`)).flat();

        this.setupMQTT();

        setInterval(() => {
            if (this.device && this.device.alive) {
                const diff = Date.now() - this.device.timestamp;

                if (diff > 1000 * 30) {
                    console.log(`Device ${this.device.id} dead!`)
                    this.device.alive = false;
                    this.status = "local";

                    const msg = {
                        topic: `/failure/${this.device.id}`,
                        qos: 1,
                        msg: ""
                    }
                    this.brokerConn.publish(msg);
                    this._deviceDeadCallback(); 
                };
            }
        }, 15 * 1000);
    }

    setProxyCallback(fn) {
        this._proxyCallback = fn;
    }

    setDeviceDeadCallback(fn) {
        this._deviceDeadCallback = fn;
    }

    setLocalCallback(fn) {
        this._localCallback = fn;
    }

    getStatus() {
        return this.status;
    }

    setStatus(status) {
        this.status = status;
    }

    setupMQTT() {
        //eslint-disable-next-line no-unused-vars
        this.brokerConn.subscribe(this.proxyTopic, 2, (topic, payload, packet) => {

            payload = JSON.parse(payload.toString());

            if (this.status === "proxy") {
                this._proxyCallback(payload)
            }
        });

        this.brokerConn.subscribe(`node/${this.textId}`, 2, (topic, payload, packet) => {
            try {
                payload = payload.toString();
                payload = JSON.parse(payload);
                this.status = payload.mode
                
                if(this.status === 'local'){
                    this._localCallback(); 
                    return; 
                }

                this.device = payload.device
                this.device.alive = true
                this.device.timestamp = Date.now()

            } catch (e) {
                this.node.error("mqtt.errors.invalid-json-parse",
                    { payload: payload, topic: topic, qos: packet.qos, retain: packet.retain });
                return;
            }
            // eslint-disable-next-line no-unused-vars
            this.brokerConn.subscribe(`ping/${this.device.id}`, 2, (topic, payload, packet) => {
                payload = JSON.parse(payload)
                if (this.device && this.device.id === payload.deviceId) {
                    this.device.timestamp = Date.now()
                }
            });

            this.sendCode();
        });
    }

    async sendCode() {
        const code = this.generateCode()
        let source = axios.CancelToken.source();
        setTimeout(() => {
            source.cancel();
        }, 15000);

        return axios({
            method: 'POST',
            url: `http://server:8080/code/${this.id}`,
            data: code,
            headers: {
                "Content-Type": "text/plain"
            },
            cancelToken: source.token
        }).then(res => {
            this.node.log(`SUCCESS in sending code to server : Status ${res.status}`);
            // Send telemetry to orchestrator nodes
            // node.receive({ type: "telemetry", device: address, data: { duration: Date.now() - startTime, state: 1 } });
            // return { id: nodeId, status: res.status };
            return true;
        }).catch(err => {
            const status = err.code && err.code === "ECONNRESET" ? 413 : (err.response ? err.response.status : 500);
            this.node.log(`ERROR in sending code to server : Status ${status}`);
            // Send telemetry to orchestrator nodes
            // node.receive({ type: "telemetry", device: address, data: { duration: Date.now() - startTime, state: 0 } });
            // return { id: nodeId, status: status }
            return false;
        })
    }


    generateCode() {
        let nodeId = `"${this.textId}"`;
        let nodeStr = `${this.node.type.replace(/ /g, '')}:${this.textId}`;
        let code =
            `\nimport gc
import sys
import ujson
import uasyncio as asyncio
mqtt_client = None
capabilities = []
client_id = None
nodes_str = "${nodeStr}"
nodes_id = [${nodeId}]
proxy_mode = ${this.status === "proxy" ? "True" : "False"}
proxy_topic = "${this.proxyTopic}"\n`

        code += this.nodeCode;

        code += `\n# General Code

async def conn_han(client):
    for input_topic in input_topics:
        await client.subscribe(input_topic, 1)

async def on_output(msg, output):
    if proxy_mode:
        await mqtt_client.publish(proxy_topic, msg, qos = 1)
    else:
        for output_topic in output:
            await mqtt_client.publish(output_topic, msg, qos = 1)

def get_nodes():
    return nodes_str

def get_input_topics(): 
    return input_topics

def get_proxy_topic():
    return proxy_topic

def set_proxy_mode(mode):
    global proxy_mode
    proxy_mode = mode

def stop():
    for id in nodes_id:
        func_name = "stop_" + id
        if func_name in globals():
            getattr(sys.modules[__name__], func_name)()

async def exec(mqtt_c, capabilities_array, c_id):
    global mqtt_client
    global capabilities
    global client_id
    mqtt_client = mqtt_c
    capabilities = capabilities_array
    client_id = c_id
    ${this.node.type === 'mqtt out' ? `await asyncio.sleep(1)` : `
    for id in nodes_id:
        func_name = "exec_" + id
        if func_name in globals():
            getattr(sys.modules[__name__], func_name)()`}
    return\n`

        return code;
    }

}

module.exports = DeviceHandler;