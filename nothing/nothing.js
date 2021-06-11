module.exports = function (RED) {
  "use strict";

  const DeviceHandler = require("devicehandler");

  function NothingNode(n) {
    RED.nodes.createNode(this, n);
    const node = this;
    this.name = n.name;

    this.micropythonCode = n.micropythonCode || "";

    this.predicates = n.predicates.length === 0 ? [] : n.predicates.split(" ");
    this.priorities = n.priorities.length === 0 ? [] : n.priorities.split(" ");

    this.broker = n.broker || this.brokerUrl;
    this.brokerConn =
      this.broker !== undefined ? RED.nodes.getNode(this.broker) : null;
    node.brokerConn && node.brokerConn.register(node);

    this.generateCode = true;
    const inputTopic = `${node.id.replace(".", "")}_input`;
    this.deviceHandler = new DeviceHandler(
      node,
      this.brokerConn,
      generateMicropythonCode()
    );
    this.deviceHandler.setProxyCallback(sendReading);
    // this.deviceHandler.setLocalCallback(handleFailure);

    function sendReading(msg) {
      node.send(msg);
    }

    this.on("input", function (msg) {
      this.send(msg);
    });

    /**
     * [MINE]
     *
     * Generates micropython code that executes the failure behaviour
     *
     * @param {*} rules
     */
    function generateMicropythonCode() {
      const textId = node.id.replace(".", "");
      const outputTopics = node.wires
        .map((inner) => inner.map((n) => `${n.replace(".", "")}_input`))
        .flat();
      const code = `\n
input_topics = ["${inputTopic}"]
output_topics = [${outputTopics.map((a) => `"${a}"`)}]

def on_input_${textId}(topic, msg, retained):
    # print(msg)
    loop = asyncio.get_event_loop()
    loop.create_task(on_output(msg, output_topics))
    return\n`;

      return code;
    }
  }
  RED.nodes.registerType("nothing", NothingNode);
};
