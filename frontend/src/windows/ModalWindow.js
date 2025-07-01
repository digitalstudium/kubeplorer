import { Utils } from "../utils/Utils";

export class ModalWindow {
  constructor(
    tab,
    modalContent,
    modalClass,
    title,
    button = "",
    buttonHandler = null,
  ) {
    this.tab = tab;
    this.windowEl = Utils.createEl("modal");
    this.windowInnerEl = Utils.createEl(modalClass);
    this.windowHeaderEl = Utils.createEl("modal-header");
    this.windowHeaderEl.append(
      Utils.createEl("modal-title", Utils.translate(title), "h2"),
      Utils.createEl("fas fa-times close-btn", "", "i"),
    );
    this.windowInnerEl.innerHTML = modalContent;
    this.windowInnerEl.prepend(this.windowHeaderEl);
    if (button) {
      const modalButton = Utils.createEl(
        "modalButton",
        Utils.translate(button),
        "button",
      );

      if (buttonHandler) {
        modalButton.addEventListener("click", () => {
          buttonHandler();
          this.close();
        });
      }
      this.windowInnerEl.append(modalButton);
    }
    this.windowEl.append(this.windowInnerEl);
    this.windowEl.querySelector(".close-btn").onclick = () => this.close();
    // this.windowEl.addEventListener("keydown", (event) => {
    //   if (event.key === "Escape") {
    //     this.close();
    //   }
    // });
    this.tab.appendChild(this.windowEl);
  }

  close() {
    this.windowEl.remove();
  }
}
