import {
  GetResourceYAML,
  DeleteResource,
  ApplyResource,
  GetEvents,
} from "../../wailsjs/go/main/App.js";
import { ForwardToOllama } from "../../wailsjs/go/main/OllamaProxy.js";

import { Utils } from "../utils/Utils.js";
import { RESOURCE_COLUMNS } from "../utils/Config.js";
import { Prompts } from "../utils/Prompts.js"; // Add this import
import { ModalWindow } from "../windows/ModalWindow.js";

import "@fortawesome/fontawesome-free/css/all.css";
import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({
  breaks: true, // Convert \n to <br>
  gfm: true, // GitHub Flavored Markdown
});

export class Resource {
  constructor(tab, cluster, namespace, apiResource, resource) {
    this.cluster = cluster;
    this.namespace = namespace;
    this.apiResource = apiResource;
    this.resource = resource;
    this.baseActions = {
      View: () => this.view(),
      Edit: () => this.edit(),
      Delete: () => this.delete(),
      Events: () => this.getEvents(),
    };
    this.extraActions = {};
    this.htmlEl = Utils.createEl("item");
    this.nameEl = Utils.createEl("resource-name");
    this.checkBoxEl = null;
    this.optionalColumnsEl = Utils.createEl("optional-columns");
    this.ageAndActionsEl = Utils.createEl("age-and-actions");
    this.ageEl = Utils.createEl("resource-age", this.resource.age);
    this.actionButtonsEl = Utils.createEl("action-buttons");
    this.editorView = null;
    this.tab = tab;
  }

  async getResourceYAML() {
    try {
      return await GetResourceYAML(
        this.cluster,
        this.apiResource,
        this.namespace,
        this.resource.name,
      );
    } catch (error) {
      console.error(
        `Failed to get YAML for resource ${this.resource.name}:`,
        error,
      );
      throw new Error(`Error fetching resource YAML: ${error}`);
    }
  }

  fill() {
    this.htmlEl.setAttribute("data-resource-name", this.resource.name);
    this.createResourceName();
    this.createOptionalColumns();
    this.createAgeAndActions();
    this.htmlEl.append(
      this.nameEl,
      this.optionalColumnsEl,
      this.ageAndActionsEl,
    );
  }

  async analyzeWithAi(
    fetchContentCallback = null,
    containerName = null,
    prompt = null,
  ) {
    try {
      // 2. Prepare the AI prompt
      if (fetchContentCallback) {
        const logs = await fetchContentCallback;

        if (containerName === "istio-proxy") {
          prompt = Prompts.getIstioProxyPrompt(logs);
        } else {
          prompt = Prompts.getLogAnalysisPrompt(
            this.resource.name,
            containerName,
            logs,
          );
        }
      }

      // 3. Send request to Ollama
      const callback = this.getAiResponse(prompt);

      await this.showEditorInModal(
        "markdown",
        () => callback,
        `AI analysis - ${this.cluster}/${this.namespace}/${this.resource.name}${containerName ? "/" + containerName : ""}`,
      );

      // console.log("AI Analysis:", JSON.parse(response));
    } catch (error) {
      console.error("Error during AI analysis:", error);
    }
  }

  async getAiResponse(prompt) {
    // Assuming prompt is a string or iterable that contains log lines
    // const logLines = prompt.split('\n');
    // prompt = logLines.slice(0, 100).join('\n');

    const response = await ForwardToOllama(
      JSON.stringify({
        model: "qwen2.5-coder:7b",
        prompt: prompt,
        stream: false,
      }),
    );

    return JSON.parse(response).response;
  }

  createResourceName() {
    this.checkBoxEl = Utils.createInputEl("checkboxItem", "", "checkbox");
    const deleteBtn = this.tab.querySelector(".floating-btn");
    this.checkBoxEl.addEventListener("change", (event) => {
      if (event.target.checked) {
        deleteBtn.style.display = "block";
      } else {
        const allCheckboxItems = this.tab.querySelectorAll(".checkboxItem");
        const anyChecked = Array.from(allCheckboxItems).some((c) => c.checked);
        deleteBtn.style.display = anyChecked ? "block" : "none";
      }
    });
    this.nameEl.append(
      this.checkBoxEl,
      this.createResourceText(),
      this.createCopyButton(),
    );
  }

  createResourceText() {
    return Utils.createEl("", this.resource.name, "span");
  }

  createCopyButton() {
    return Utils.createActionBtn("Copy", this.resource.name, (event) =>
      Utils.copy(event, this.resource.name),
    );
  }

  createOptionalColumns() {
    const columns = RESOURCE_COLUMNS[this.apiResource] || [];

    columns.forEach((column) => {
      let value;
      if (this.resource[column.key] !== undefined) {
        value = this.resource[column.key];
      } else if (
        this.resource.spec &&
        this.resource.spec[column.key] !== undefined
      ) {
        value = this.resource.spec[column.key];
      } else {
        value = ""; // Значение по умолчанию
      }

      const columnEl = Utils.createEl(`resource-${column.key}`, value);
      columnEl.dataset[column.key] = value;
      this.optionalColumnsEl.append(columnEl);
    });
  }

  createAgeAndActions() {
    Object.entries({
      ...this.baseActions,
      ...this.extraActions,
    }).forEach(([hint, action]) => {
      const button = Utils.createActionBtn(hint, this.resource.name, action);
      this.actionButtonsEl.append(button);
    });
    this.ageAndActionsEl.append(this.ageEl, this.actionButtonsEl);
  }

  async showEditorInModal(
    type,
    fetchContentCallback,
    title,
    button = null,
    buttonHandler = null,
    editable = false,
  ) {
    Utils.showLoadingIndicator(Utils.translate("Fetching data"), this.tab);
    try {
      const content = await Promise.resolve(fetchContentCallback());
      this.setupEditorView(
        content,
        title,
        button,
        buttonHandler,
        type,
        editable,
      );
    } catch (error) {
      console.error("Error fetching resource content:", error);
    } finally {
      Utils.hideLoadingIndicator(this.tab);
    }
  }

  setupEditorView(content, title, button, buttonHandler, type, editable) {
    const modalContent = `<div class="editor"></div>`;
    new ModalWindow(
      this.tab,
      modalContent,
      "yaml-content",
      title,
      button,
      buttonHandler,
    );

    const container = this.tab.querySelector(".editor");

    if (type === "markdown") {
      // Directly render Markdown as HTML
      container.innerHTML = DOMPurify.sanitize(marked.parse(content));
      container.classList.add("markdown-preview"); // Add styling class
      return; // Skip editor initialization for markdown
    }
    if (this.editorView) {
      this.editorView.dispose();
    }
    this.editorView = Utils.createMonaco(container, content, type, editable);
  }

  async view() {
    await this.showEditorInModal(
      "yaml",
      () => this.getResourceYAML(),
      Utils.translate("View") +
        ` - ${this.cluster}/${this.namespace}/${this.apiResource}/${this.resource.name}`,
    );
  }

  async update() {
    try {
      Utils.showLoadingIndicator(
        Utils.translate("Updating resource"),
        this.tab,
      );
      const updatedContent = this.editorView.getValue(); // Get content from Monaco
      await ApplyResource(this.cluster, updatedContent);
      Utils.hideLoadingIndicator(this.tab);
      alert(
        `Resource ${this.resource.name} of kind ${this.apiResource} updated successfully.`,
      );
    } catch (error) {
      console.error(`Failed to update resource ${this.resource.name}:`, error);
      alert(`Failed to update resource ${this.resource.name}:`, error);
    } finally {
      Utils.hideLoadingIndicator(this.tab);
    }
  }

  async edit() {
    await this.showEditorInModal(
      "yaml",
      () => this.getResourceYAML(),
      Utils.translate("Edit") +
        ` - ${this.cluster}/${this.namespace}/${this.apiResource}/${this.resource.name}`,
      "Save",
      () => this.update(),
      true,
    );
  }

  async delete() {
    if (
      !confirm(
        `Are you sure you want to delete ${this.apiResource} "${this.resource.name}" in namespace "${this.namespace}"?`,
      )
    ) {
      return;
    }

    try {
      Utils.showLoadingIndicator(
        Utils.translate("Deleting resource"),
        this.tab,
      );
      await DeleteResource(
        this.cluster,
        this.namespace,
        this.apiResource,
        this.resource.name,
      );
      Utils.hideLoadingIndicator(this.tab);
      if (this.tab.classList.contains("active")) {
        alert(`Resource ${this.resource.name} deleted successfully.`);
      }
    } catch (error) {
      console.error(`Failed to delete resource ${this.resource.name}:`, error);
    } finally {
      Utils.hideLoadingIndicator(this.tab);
    }
  }

  async getEvents() {
    try {
      Utils.showLoadingIndicator(Utils.translate("Fetching events"), this.tab);

      // Call the DescribePod function from the backend
      const events = await GetEvents(
        this.cluster,
        this.apiResource,
        this.namespace,
        this.resource.name,
      );

      if (!events || events == "null") {
        Utils.hideLoadingIndicator(this.tab);
        alert(Utils.translate("No events found"));
        return;
      }

      const prompt = Prompts.getEventsAnalysisPrompt(this.apiResource, events);

      // Display the pod description in a modal
      this.setupEditorView(
        events,
        Utils.translate("Events") +
          ` - ${this.cluster}/${this.namespace}/${this.resource.name}`,
        Utils.translate("Analyze with AI"),
        () => this.analyzeWithAi(null, null, prompt),
        "json", // Use "text" type for plain text display
        false, // Not editable
      );
    } catch (error) {
      console.error("Error fetching events:", error);
      alert(`Failed to fetch events: ${error.message}`);
    } finally {
      Utils.hideLoadingIndicator(this.tab);
    }
  }
}
