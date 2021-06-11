

module.exports = function (RED) {
    "use strict";

    const DeviceHandler = require('devicehandler')

    function AndNode(n) {
        RED.nodes.createNode(this, n);
        const node = this;
        this.name = n.name;
        this.property = n.property;
        this.propertyType = n.propertyType || "msg";
        this.count = parseInt(n.count);
        
        this.predicates = n.predicates.length === 0 ? [] : n.predicates.split(" "); 
        this.priorities = n.priorities.length === 0 ? [] : n.priorities.split(" "); 


        this.broker = n.broker || this.brokerUrl;
        this.brokerConn = this.broker !== undefined ? RED.nodes.getNode(this.broker) : null;
        node.brokerConn && node.brokerConn.register(node);


        this.generateCode = true;
        this.deviceHandler = new DeviceHandler(node, this.brokerConn, generateMicropythonCode(this.property, this.count))
        this.deviceHandler.setProxyCallback(sendReading);

        function sendReading(msg) {
            node.send(msg);
        }

        this.topics = []
        this.inputs = [];

        this.on("input", function (msg, done) {
            try {
                const value = RED.util.getMessageProperty(msg, this.property);

                if (Object.prototype.hasOwnProperty.call(msg, "node_id") && this.topics.indexOf(msg.node_id) === -1) {
                    this.inputs.push(value);
                    this.topics.push(msg.topic);
                }

                if (this.topics.length === this.count) {
                    let result = true;
                    for (let i = 0; i < this.inputs.length; i++) {
                        result = result && this.inputs[i];
                    }

                    const msg = { payload: result };
                    node.send(msg);

                    this.topics = [];
                    this.inputs = [];
                }
            } catch (err) {
                done(JSON.stringify(err));
            }
        });
        this.on("close", function () {
            this.status({});
        });

        generateMicropythonCode(this.property, this.count);

        /**
         * [MINE]
         * 
         * Generates micropython code that exxecutes the switch behaviour
         * 
         * @param {*} rules 
         */
        function generateMicropythonCode(property, count) {

            const textId = node.id.replace(".", "")
            const outputTopics = node.wires.map(inner => inner.map(n => `${n.replace(".", "")}_input`)).flat();
            const inputTopic = `${node.id.replace(".", "")}_input`;

            const code =
                `\ninput_topics = ["${inputTopic}"]
output_topics_${textId} = [${outputTopics.map(a => `"${a}"`)}]
nr_inputs_${textId} = ${count}
property_${textId} = "${property}"
inputs_${textId} = []
topics_${textId} = []

def get_property_value_${textId}(msg):
    properties = property_${textId}.split(".")
    payload = msg

    for property in properties:
        try:
            if property in payload:
                payload = payload[property]
            else:
                print("${textId}: Property not found")
                break
        except:
            print("${textId}: Msg is not an object")
            break

    return payload

def on_input_${textId}(topic, msg, retained):
    global inputs_${textId}
    global topics_${textId}

    msg = ujson.loads(msg)

    node_topic = msg["node_id"]

    if node_topic not in topics_${textId}:
        topics_${textId}.append(node_topic)
        msg = get_property_value_${textId}(msg)
        if (msg == 'True') or (msg == 'true') or (msg == True):
            inputs_${textId}.append(True)
        elif (msg == 'False') or (msg == 'false') or (msg == False):
            inputs_${textId}.append(False)
    
    if len(topics_${textId}) == nr_inputs_${textId}:
        result = True
        for entry in inputs_${textId}:
            result = result and entry
        res = dict(
            payload=result,
            device_id = client_id,
            node_id=node_id
        )
        loop = asyncio.get_event_loop()
        loop.create_task(on_output(ujson.dumps(res), output_topics_${textId}))
        inputs_${textId} = []
        topics_${textId} = []
    
    return\n`

        return code;
        }

    }
    RED.nodes.registerType("and", AndNode);
};
