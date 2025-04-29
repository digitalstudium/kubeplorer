import { Resource } from "./Resource";

import { Utils } from "./Utils.js";

import "@fortawesome/fontawesome-free/css/all.css";
import * as jsyaml from "js-yaml";

import { marked } from "marked";

marked.setOptions({
  breaks: true, // Convert \n to <br>
  gfm: true, // GitHub Flavored Markdown
});

export class SecretResource extends Resource {
  constructor(tab, cluster, namespace, apiResource, resource) {
    super(tab, cluster, namespace, apiResource, resource);
    this.extraActions = {
      Decode: () => this.decode(),
    };
  }

  async decodeHelper() {
    let result = await this.getResourceYAML();

    const resourceObject = jsyaml.load(result); // parse YAML into a JS object
    if (resourceObject.data) {
      for (const key in resourceObject.data) {
        // Decode each entry from base64
        resourceObject.data[key] = atob(resourceObject.data[key]);
      }
    }
    // Re‐serialize back to YAML
    result = jsyaml.dump(resourceObject);
    return result;
  }

  async decode() {
    try {
      let fetchContentCallback = this.decodeHelper();
      await this.showEditorInModal(
        "yaml",
        () => fetchContentCallback,
        Utils.translate("Decode") +
          ` - ${this.cluster}/${this.namespace}/${this.apiResource}/${this.resource.name}`,
      );
    } catch (error) {
      console.error("Error viewing resource:", error);
    }
  }
}
