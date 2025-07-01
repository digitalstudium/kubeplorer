import { ModalWindow } from "./ModalWindow";

export class GroupModalWindow extends ModalWindow {
  constructor(
    tab,
    modalContent,
    modalClass,
    title,
    button,
    buttonHandler,
    searchId,
    listId,
  ) {
    super(tab, modalContent, modalClass, title, button, buttonHandler);
    this.searchBoxEl = document.getElementById(searchId);
    this.listId = listId;
    this.searchBoxEl.addEventListener("input", () => this.filterItems());
  }
  filterItems() {
    const searchText = this.searchBoxEl.value.toLowerCase();
    const items = document.querySelectorAll(`#${this.listId} .group-item`);

    items.forEach((item) => {
      const label = item.querySelector("label").textContent.toLowerCase();
      item.style.display = label.includes(searchText) ? "" : "none";
    });
  }
  static saveGroups(apiResourcesGroups) {
    localStorage.setItem("resourceGroups", JSON.stringify(apiResourcesGroups));
  }
}
