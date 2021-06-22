# node-red-contrib-decentralized-computation

Decentralized Computation extensions for Node-RED. 

This package provides a platform to distribute the computation of Node-RED flows across edge devices. It introduces an Orchestrator node capable of decomposing and allocating the nodes to multiple IoT devices. Each node is capable of generating its own Micropython code that is to be installed in the edge device running a custom-made firmware.

This platform provides a resilient and decentralized orchestration mechanism capable of handling devices failures in real-time by reallocating the tasks. When it is not possible to allocate a node to a device, due to physical constraints, we introduced a fallback mechanism that allows the user to define an alternative flow to when a specific node fails.

This work is part of a master thesis in Software Engineering and Internet-of-Things by [Pedro Costa](https://github.com/pmscosta) at the Faculty of Engineering, University of Porto (FEUP). Work supervised by Prof. [Hugo Sereno Ferreia](http://hugosereno.eu/) and Prof. [André Restivo](https://web.fe.up.pt/~arestivo/). With collaboration of [João Pedro Dias](http://jpdias.me).

**This work is at an early development stage!**

## Example Usage

<figure>
  <img
  src="./docs/temperature-compensate.png"
  alt="The beautiful MDN logo.">
  <figcaption>Example flow containing two temperature nodes that can trigger the AC to turn on. If the temperature sensor fails, Node-RED can replace its data by querying a Weather API. </figcaption>
</figure>


## Development

- Installing Node-RED (Official Docs): [https://nodered.org/docs/getting-started/](https://nodered.org/docs/getting-started/)

### Installing node-red-contrib-decentralized-computation for development

- Clone or download this repository.
- In your node-red user directory, typically ~/.node-red (in Windows something like `C:\Users\<my_name>\.node_red`), run: `npm install <path_to_downloaded_folder>/node-red-contrib-decentralized-computation`
- Start (or restart) Node-RED.
- Nodes should be available under the `orchestrator` and `micropython` tabs of the _node palette_.


### Helper documentation

- [Installing Custom Nodes -- Official Documentation](https://nodered.org/docs/creating-nodes/first-node#testing-your-node-in-node-red)