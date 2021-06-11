module.exports = function (RED) {
    
    const DeviceHandler = require('devicehandler')

    function TemperatureHumidityNode(n) {
        RED.nodes.createNode(this, n);
        const node = this;
        const pin = parseInt(n.pin);
        const repeat = Boolean(n.repeat);
        const interval = parseFloat(n.interval)
        // const action = n.action;

        this.broker = n.broker || this.brokerUrl;
        this.brokerConn = this.broker !== undefined ? RED.nodes.getNode(this.broker) : null;
        node.brokerConn && node.brokerConn.register(node);

        this.generateCode = true;
        this.predicates = n.predicates.length === 0 ? [] : n.predicates.split(" ");
        this.priorities = n.priorities.length === 0 ? [] : n.priorities.split(" ");
        this.deviceHandler = new DeviceHandler(node, this.brokerConn, generateMicropythonCode(pin, repeat, interval))
        this.deviceHandler.setProxyCallback(sendReading);
        this.deviceHandler.setLocalCallback(handleFailure);
        // this.deviceHandler.setDeviceDeadCallback(handleFailure);

        this.on("close", function (done) {
            this.status({});
            node.brokerConn.deregister(node, done);
        });

        // Simply send a message through the second output
        function handleFailure() {
            node.send([null, { payload: "Device failed", start: true}]);
        }

        function sendReading(msg) {
            msg.payload = JSON.parse(msg.payload)
            // const reading = RED.util.getMessageProperty(msg, "payload");
            node.send(msg);
        }

        this.on("input", function (msg) {
            const reading = RED.util.getMessageProperty(msg, "payload");
            node.send(reading);
        });


        /**
         * [MINE]
         * 
         * Generates micropython code that exxecutes the switch behaviour
         * 
         * @param {*} rules 
         */
        function generateMicropythonCode(pin, repeat, interval) {
            const textId = node.id.replace(".", "")
            const outputTopics = node.wires.map(inner => inner.map(n => `${n.replace(".", "")}_input`)).flat();

            const code = `\n
# Node specific 

import dht
import machine
import sys
import utime
input_topics = ["${textId}_input"]
output_topics = [${outputTopics.map(n => `"${n}"`)}]
pin_${textId} = ${pin}
interval_${textId} = ${interval}
repeat_${textId} = ${repeat === false ? "False" : "True"}
stop_repeat_${textId} = False
timer_task_${textId} = None

reference_timer_workaround = []

def measure_${textId}(_):
    pin = None
    if sys.platform != "linux":
        pin = machine.Pin(pin_${textId})
    d = dht.DHT22(pin)
    d.measure()
    temperature = d.temperature()
    humidity = d.humidity()
    results = dict(
        temperature=temperature,
        humidity=humidity,
        _msgid=str(utime.ticks_ms()),
    )
    msg = dict(
        payload=ujson.dumps(results),
        device_id=client_id,
        node_id=node_id
    )
    print("[TEMPERATURE]: Got reading {}".format(msg))
    loop = asyncio.get_event_loop()
    loop.create_task(on_output(ujson.dumps(msg), output_topics))

def stop_${textId}():
    global stop_repeat_${textId}
    stop_repeat_${textId} = True
    if timer_task_${textId}:
        timer_task_${textId}.cancel()
    for timer in reference_timer_workaround:
        timer.deinit()

async def timer_exec_${textId}(callback, interval):
    global timer_task_${textId}
    if stop_repeat_${textId}:
        return
    callback(None)
    await asyncio.sleep_ms(interval)
    loop = asyncio.get_event_loop()
    timer_task_${textId} = loop.create_task(timer_exec_${textId}(callback, interval))

def exec_${textId}():
    if repeat_${textId}:
        if sys.platform != "linux":
            timer = machine.Timer(-1)    
            timer.init(period=interval_${textId}, mode=machine.Timer.PERIODIC, callback=measure_${textId})
            reference_timer_workaround.append(timer)
        else:
            loop = asyncio.get_event_loop()
            loop.create_task(timer_exec_${textId}(measure_${textId}, interval_${textId}))
    else: 
        measure_${textId}(None)
    return`
            return code;
        }

    }
    RED.nodes.registerType("temperature-humidity", TemperatureHumidityNode);
};
