import { GetPodContainerLogs } from "../../wailsjs/go/main/App.js";

import { Resource } from "./Resource";
import { ModalWindow } from "../windows/ModalWindow.js";
import { Utils } from "../utils/Utils.js";

import "@fortawesome/fontawesome-free/css/all.css";
import { Terminal } from "@xterm/xterm";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { marked } from "marked";

marked.setOptions({
  breaks: true, // Convert \n to <br>
  gfm: true, // GitHub Flavored Markdown
});

export class PodResource extends Resource {
  constructor(tab, cluster, namespace, apiResource, resource) {
    super(tab, cluster, namespace, apiResource, resource);
    this.extraActions = {
      Logs: (event) => this.openLogs(event, this.actionButtonsEl),
      Terminal: (event) => this.openTerminal(event, this.actionButtonsEl),
    };
    if (this.resource.containers.includes("istio-proxy")) {
      this.extraActions["Istio config"] = () =>
        this.showEnvoyConfig("istio-proxy", "curl,localhost:15000/config_dump");
    } else if (
      this.resource.name.startsWith("istio") &&
      this.resource.containers.includes("discovery")
    ) {
      this.extraActions["Istio registryz"] = () =>
        this.showEnvoyConfig(
          "discovery",
          "curl,localhost:15014/debug/registryz",
        );
    }
  }

  async openTerminal(event, resourceItem) {
    if (this.resource.containers.length > 1) {
      this.setupDropdown(
        event,
        resourceItem,
        this.connectToTerminal.bind(this),
      );
      return;
    }
    this.connectToTerminal(this.resource.containers[0]);
  }

  async openLogs(event, resourceItem) {
    if (this.resource.containers.length > 1) {
      this.setupDropdown(event, resourceItem, this.viewLogs.bind(this));
      return;
    }
    this.viewLogs(this.resource.containers[0]);
  }

  setupDropdown(event, resourceItem, actionHandler) {
    event.stopPropagation(); // Prevent parent click events
    // Create the dropdown with the provided action handler
    const dropdown = this.createDropdown(actionHandler);
    // Append the dropdown to the resource item
    resourceItem.append(dropdown);
    // Position the dropdown relative to the mouse pointer
    dropdown.style.left = `${event.pageX - dropdown.clientWidth + 15}px`;
    dropdown.style.top = `${event.pageY - 15}px`;
    // Remove the dropdown when the mouse leaves it
    dropdown.onmouseleave = () => {
      dropdown.remove();
    };
  }

  createDropdown(actionHandler) {
    const dropdown = Utils.createEl("btn-dropdown");
    this.resource.containers.forEach((container) => {
      const containerEl = Utils.createEl("btn-dropdown-item", container);
      containerEl.onclick = () => {
        actionHandler(container); // Call the passed function with the container
        dropdown.remove(); // Remove the dropdown after the action
      };
      dropdown.appendChild(containerEl);
    });
    return dropdown;
  }

  connectToTerminal(containerName) {
    const title =
      Utils.translate("Terminal") +
      ` - ${this.cluster}/${this.namespace}/${this.resource.name}/${containerName}`;
    const modalContent = `<div id="terminal"></div>`;
    new ModalWindow(this.tab, modalContent, "terminal-content", title);

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 20,
      fontFamily: "Courier New",
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());
    terminal.open(document.getElementById("terminal"));
    fitAddon.fit();
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.ctrlKey && event.shiftKey && event.code === "KeyC") {
        event.preventDefault();
        const selection = terminal.getSelection();
        if (selection) {
          navigator.clipboard.writeText(selection);
        }
        return false;
      }

      // Ctrl+L для очистки терминала:
      if (event.ctrlKey && event.code === "KeyL") {
        event.preventDefault();
        terminal.clear();
        return false;
      }

      return true;
    });
    let xtermSize = fitAddon.proposeDimensions();
    let resizeMessage = {
      type: "resize",
      cols: xtermSize.cols,
      rows: xtermSize.rows,
    };

    // WebSocket connection
    const socket = new WebSocket(
      `ws://localhost:34116/terminal?` +
        `cluster=${encodeURIComponent(this.cluster)}&` +
        `namespace=${encodeURIComponent(this.namespace)}&` +
        `pod=${encodeURIComponent(this.resource.name)}&` +
        `container=${encodeURIComponent(containerName)}&` +
        `command=${encodeURIComponent("/bin/sh")}`,
    );

    socket.onopen = function () {
      terminal.focus();
      socket.send(JSON.stringify(resizeMessage));
      terminal.write(Utils.translate("connecting") + "...\r\n");
      console.log("websocket opened");
    };

    socket.onmessage = function (event) {
      terminal.write(event.data);
    };

    socket.onerror = function (event) {
      console.error("WebSocket error:", event);
    };

    socket.onclose = function () {
      console.log("websocket closed");
      terminal.write(Utils.translate("\r\nconnection closed\r\n"));
    };

    terminal.onData(function (data) {
      socket.send(data);
    });

    // Handle window resize
    window.addEventListener("resize", () => {
      fitAddon.fit();
      xtermSize = fitAddon.proposeDimensions();
      resizeMessage = {
        type: "resize",
        cols: xtermSize.cols,
        rows: xtermSize.rows,
      };
      socket.send(JSON.stringify(resizeMessage));
    });
  }

  async getEnvoyConfig(container, command) {
    const response = await fetch(
      `http://localhost:34116/envoy?` +
        `cluster=${encodeURIComponent(this.cluster)}&` +
        `namespace=${encodeURIComponent(this.namespace)}&` +
        `pod=${encodeURIComponent(this.resource.name)}&` +
        `container=${encodeURIComponent(container)}&` +
        `command=${encodeURIComponent(command)}`,
    );
    return JSON.stringify(JSON.parse(await response.text()), null, 2);
  }

  async showEnvoyConfig(container, command) {
    const fetchContentCallback = this.getEnvoyConfig(container, command);
    await this.showEditorInModal(
      "json",
      () => fetchContentCallback,
      Utils.translate("Istio config") +
        ` - ${this.cluster}/${this.namespace}/${this.resource.name}`,
    );
  }

  async viewLogs(containerName) {
    try {
      const fetchContentCallback = GetPodContainerLogs(
        this.cluster,
        this.namespace,
        this.resource.name,
        containerName,
      );
      // Create and show modal with resource details
      await this.showEditorInModal(
        "json",
        () => fetchContentCallback,
        Utils.translate("Logs") +
          ` - ${this.cluster}/${this.namespace}/${this.resource.name}/${containerName}`,
        Utils.translate("Analyze with AI"),
        () => this.analyzeWithAi(fetchContentCallback, containerName),
      );
    } catch (error) {
      console.error("Error viewing resource:", error);
    }
  }
}
