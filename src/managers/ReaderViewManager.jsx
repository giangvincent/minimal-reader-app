import DefaultViewManager from "epubjs/src/managers/default";

export class ReaderViewManager extends DefaultViewManager {
  addEventListeners() {
    const scroller = this.settings.fullsize ? window : this.container;
    this._onScroll = this.onScroll.bind(this);
    scroller.addEventListener("scroll", this._onScroll);
  }
}

export default ReaderViewManager;