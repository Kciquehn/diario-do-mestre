import { DOCUMENT_TYPES, FLAGS, MODULE_ID } from "../constants.js";
import { ResourceService, normalizeCityMap } from "../services/resource-service.js?v=1.4.7";
import { createId } from "../utils/id.js";
import { getElementWindow } from "../compat/popout.js";

const { DialogV2 } = foundry.applications.api;
const LOCATION_SIZE_MIN = 0.6;
const LOCATION_SIZE_MAX = 2;
const LOCATION_SIZE_DRAG_DISTANCE = 140;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export class CityMapController {
  constructor({ root, page, onChange, openResource, onResourceCreated }) {
    this.root = root;
    this.page = page;
    this.onChange = onChange;
    this.openResource = openResource;
    this.onResourceCreated = onResourceCreated;
    this.state = normalizeCityMap(root.querySelector("[name='cityMap']")?.value);
    this.panState = null;
    this.locationDrag = null;
    this.locationResize = null;
    this.ignoreResizeClick = null;
  }

  activate() {
    this.destroy();
    const view = getElementWindow(this.root);
    this.listenerController = new view.AbortController();
    const listenerOptions = { signal: this.listenerController.signal };
    this.viewport = this.root.querySelector("[data-city-map-viewport]");
    this.stage = this.root.querySelector("[data-city-map-stage]");
    this.background = this.root.querySelector("[data-city-map-background]");
    this.locationLayer = this.root.querySelector("[data-city-map-locations]");
    this.serialized = this.root.querySelector("[name='cityMap']");
    this.imageInput = this.root.querySelector("[name='cityMapImage']");
    this.zoomLabel = this.root.querySelector("[data-city-map-zoom]");

    this.root.addEventListener("click", this.#onClick.bind(this), listenerOptions);
    this.root.addEventListener("pointerdown", this.#onPointerDown.bind(this), listenerOptions);
    this.root.addEventListener("pointermove", this.#onPointerMove.bind(this), listenerOptions);
    this.root.addEventListener("pointerup", this.#onPointerUp.bind(this), listenerOptions);
    this.root.addEventListener("pointercancel", this.#onPointerUp.bind(this), listenerOptions);
    this.viewport.addEventListener("wheel", this.#onWheel.bind(this), { ...listenerOptions, passive: false });
    this.viewport.addEventListener("keydown", this.#onKeyDown.bind(this), listenerOptions);
    this.#renderImage();
    this.#renderLocations();
    this.#applyTransform();
    this.#sync(false);
  }

  destroy() {
    this.listenerController?.abort();
    this.listenerController = null;
    this.panState = null;
    this.locationDrag = null;
    this.locationResize = null;
    this.ignoreResizeClick = null;
  }

  #sync(notify = true) {
    this.state = normalizeCityMap(this.state);
    if (this.serialized) this.serialized.value = JSON.stringify(this.state);
    if (this.imageInput) this.imageInput.value = this.state.image;
    this.#applyTransform();
    if (notify) this.onChange?.();
  }

  #applyTransform() {
    if (!this.stage) return;
    this.stage.style.transform = `translate(${this.state.panX}px, ${this.state.panY}px) scale(${this.state.zoom})`;
    if (this.zoomLabel) {
      this.zoomLabel.textContent = game.i18n.format("DMJ.CityMap.Zoom", { zoom: Math.round(this.state.zoom * 100) });
    }
  }

  #renderImage() {
    if (!this.background) return;
    const actionLabel = this.root.querySelector("[data-city-map-image-action-label]");
    if (actionLabel) actionLabel.textContent = game.i18n.localize(this.state.image ? "DMJ.CityMap.ChangeImage" : "DMJ.CityMap.SelectImage");
    this.background.replaceChildren();
    if (this.state.image) {
      const image = this.root.ownerDocument.createElement("img");
      image.alt = "";
      image.draggable = false;
      image.decoding = "async";
      const applyAspectRatio = () => {
        if (!image.isConnected || !image.naturalWidth || !image.naturalHeight) return;
        this.viewport?.style.setProperty("--dmj-city-map-aspect-ratio", `${image.naturalWidth} / ${image.naturalHeight}`);
      };
      image.addEventListener("load", applyAspectRatio, { once: true, signal: this.listenerController?.signal });
      image.src = this.state.image;
      this.background.append(image);
      this.root.classList.add("has-map-image");
      if (image.complete) applyAspectRatio();
      return;
    }
    this.viewport?.style.removeProperty("--dmj-city-map-aspect-ratio");
    const empty = this.root.ownerDocument.createElement("div");
    empty.className = "dmj-city-map-empty";
    const icon = this.root.ownerDocument.createElement("i");
    icon.className = "fa-solid fa-map";
    icon.setAttribute("aria-hidden", "true");
    const text = this.root.ownerDocument.createElement("span");
    text.textContent = game.i18n.localize("DMJ.CityMap.Empty");
    empty.append(icon, text);
    this.background.append(empty);
    this.root.classList.remove("has-map-image");
  }

  #renderLocations() {
    if (!this.locationLayer) return;
    this.locationLayer.replaceChildren();
    for (const location of this.state.locations) this.locationLayer.append(this.#createLocationElement(location));
  }

  #createLocationElement(location) {
    const marker = this.root.ownerDocument.createElement("div");
    marker.className = "dmj-city-location";
    marker.dataset.cityLocation = location.id;
    marker.classList.toggle("locked", location.locked);
    marker.style.left = `${location.x}%`;
    marker.style.top = `${location.y}%`;
    marker.style.setProperty("--dmj-city-location-scale", String(location.size));

    const pin = this.root.ownerDocument.createElement("button");
    pin.type = "button";
    pin.className = "dmj-city-location-pin";
    pin.dataset.action = "drag-city-location";
    pin.setAttribute("aria-label", game.i18n.localize("DMJ.CityMap.MoveLocation"));
    pin.title = game.i18n.localize("DMJ.CityMap.MoveLocation");
    const pinIcon = this.root.ownerDocument.createElement("i");
    pinIcon.className = "fa-solid fa-location-dot";
    pinIcon.setAttribute("aria-hidden", "true");
    pin.append(pinIcon);

    const open = this.root.ownerDocument.createElement("button");
    open.type = "button";
    open.className = "dmj-city-location-name";
    open.dataset.action = "open-city-location";
    open.textContent = location.name;
    open.title = game.i18n.localize("DMJ.CityMap.OpenLocation");

    const remove = this.root.ownerDocument.createElement("button");
    remove.type = "button";
    remove.className = "dmj-city-location-remove";
    remove.dataset.action = "remove-city-location";
    remove.setAttribute("aria-label", game.i18n.localize("DMJ.CityMap.RemoveLocation"));
    remove.title = game.i18n.localize("DMJ.CityMap.RemoveLocation");
    const removeIcon = this.root.ownerDocument.createElement("i");
    removeIcon.className = "fa-solid fa-xmark";
    removeIcon.setAttribute("aria-hidden", "true");
    remove.append(removeIcon);

    const lock = this.root.ownerDocument.createElement("button");
    lock.type = "button";
    lock.className = "dmj-city-location-lock";
    lock.dataset.action = "toggle-city-location-lock";
    this.#updateLockButton(lock, location.locked);

    const resize = this.root.ownerDocument.createElement("button");
    resize.type = "button";
    resize.className = "dmj-city-location-resize";
    resize.dataset.action = "resize-city-location";
    resize.setAttribute("aria-label", game.i18n.localize("DMJ.CityMap.ResizeLocation"));
    resize.title = game.i18n.localize("DMJ.CityMap.ResizeLocation");
    const resizeIcon = this.root.ownerDocument.createElement("i");
    resizeIcon.className = "fa-solid fa-up-right-and-down-left-from-center";
    resizeIcon.setAttribute("aria-hidden", "true");
    resize.append(resizeIcon);

    resize.disabled = location.locked;
    marker.append(pin, open, lock, remove, resize);
    return marker;
  }

  #updateLockButton(button, locked) {
    const label = game.i18n.localize(locked ? "DMJ.CityMap.UnlockLocation" : "DMJ.CityMap.LockLocation");
    button.setAttribute("aria-label", label);
    button.title = label;
    button.classList.toggle("active", locked);
    button.replaceChildren();
    const icon = button.ownerDocument.createElement("i");
    icon.className = `fa-solid ${locked ? "fa-lock" : "fa-lock-open"}`;
    icon.setAttribute("aria-hidden", "true");
    button.append(icon);
  }

  async #onClick(event) {
    const button = event.target.closest("[data-action]");
    if (!button || !this.root.contains(button)) return;
    const action = button.dataset.action;
    if (action === "select-city-map") {
      event.preventDefault();
      await this.#selectImage(button);
      return;
    }
    if (action === "add-city-location") {
      event.preventDefault();
      await this.#addLocation();
      return;
    }
    if (action === "reset-city-map-view") {
      event.preventDefault();
      this.state.panX = 0;
      this.state.panY = 0;
      this.state.zoom = 1;
      this.#sync();
      return;
    }
    const marker = button.closest("[data-city-location]");
    if (!marker) return;
    if (action === "open-city-location") {
      event.preventDefault();
      await this.#openLocation(marker.dataset.cityLocation);
      return;
    }
    if (action === "remove-city-location") {
      event.preventDefault();
      this.state.locations = this.state.locations.filter((location) => location.id !== marker.dataset.cityLocation);
      this.#renderLocations();
      this.#sync();
      return;
    }
    if (action === "toggle-city-location-lock") {
      event.preventDefault();
      const location = this.state.locations.find((entry) => entry.id === marker.dataset.cityLocation);
      if (!location) return;
      location.locked = !location.locked;
      marker.classList.toggle("locked", location.locked);
      marker.querySelector("[data-action='resize-city-location']").disabled = location.locked;
      this.#updateLockButton(button, location.locked);
      this.#sync();
      return;
    }
    if (action === "resize-city-location") {
      event.preventDefault();
      if (this.ignoreResizeClick === marker.dataset.cityLocation) {
        this.ignoreResizeClick = null;
        return;
      }
      const location = this.state.locations.find((entry) => entry.id === marker.dataset.cityLocation);
      if (!location || location.locked) return;
      location.size = location.size >= LOCATION_SIZE_MAX ? LOCATION_SIZE_MIN : clamp(Math.round((location.size + 0.2) * 10) / 10, LOCATION_SIZE_MIN, LOCATION_SIZE_MAX);
      marker.style.setProperty("--dmj-city-location-scale", String(location.size));
      this.#sync();
    }
  }

  async #selectImage(button) {
    try {
      const FilePickerClass = foundry.applications.apps.FilePicker.implementation;
      const picker = FilePickerClass.fromButton(button);
      picker.callback = (path) => {
        this.state.image = String(path ?? "").trim();
        this.#renderImage();
        this.#sync();
      };
      await picker.render({ force: true });
    } catch (error) {
      console.error(`${MODULE_ID} |`, error);
      ui.notifications.error(error.message);
    }
  }

  #locationDialogContent(places) {
    const content = this.root.ownerDocument.createElement("div");
    const fields = this.root.ownerDocument.createElement("div");
    fields.className = "dmj-city-location-dialog";
    const selectLabel = this.root.ownerDocument.createElement("label");
    const selectText = this.root.ownerDocument.createElement("span");
    selectText.textContent = game.i18n.localize("DMJ.CityMap.ExistingLocation");
    const select = this.root.ownerDocument.createElement("select");
    select.name = "uuid";
    const newOption = this.root.ownerDocument.createElement("option");
    newOption.value = "";
    newOption.textContent = game.i18n.localize("DMJ.CityMap.NewLocation");
    select.append(newOption);
    for (const place of places) {
      const option = this.root.ownerDocument.createElement("option");
      option.value = place.uuid;
      option.textContent = place.name;
      select.append(option);
    }
    selectLabel.append(selectText, select);

    const nameLabel = this.root.ownerDocument.createElement("label");
    const nameText = this.root.ownerDocument.createElement("span");
    nameText.textContent = game.i18n.localize("DMJ.CityMap.LocationName");
    const name = this.root.ownerDocument.createElement("input");
    name.type = "text";
    name.name = "name";
    name.maxLength = 120;
    name.required = true;
    name.autofocus = true;
    name.placeholder = game.i18n.localize("DMJ.CityMap.LocationNamePlaceholder");
    select.addEventListener("change", () => {
      const place = places.find((entry) => entry.uuid === select.value);
      if (place) name.value = place.name;
    });
    nameLabel.append(nameText, name);
    fields.append(selectLabel, nameLabel);
    content.append(fields);
    return content;
  }

  async #addLocation() {
    try {
      const places = ResourceService.getResources()
        .filter((page) => ResourceService.getData(page).kind === "place")
        .map((page) => ({ uuid: page.uuid, name: page.name, page }));
      const data = await DialogV2.input({
        window: { title: game.i18n.localize("DMJ.CityMap.LocationDialogTitle") },
        content: this.#locationDialogContent(places),
        modal: true,
        rejectClose: false,
        ok: {
          label: game.i18n.localize("DMJ.CityMap.Add"),
          callback: (_event, dialogButton) => ({
            uuid: dialogButton.form.elements.uuid.value,
            name: dialogButton.form.elements.name.value
          })
        }
      });
      if (!data) return;
      let place = places.find((entry) => entry.uuid === data.uuid)?.page;
      if (!place) {
        place = await ResourceService.createResource("place", data.name);
        await this.onResourceCreated?.(place);
      }
      if (this.state.locations.some((location) => location.uuid === place.uuid)) {
        ui.notifications.info(game.i18n.localize("DMJ.CityMap.LocationDuplicate"));
        return;
      }
      const position = this.#viewportCenter();
      this.state.locations.push({ id: createId(), uuid: place.uuid, name: place.name, size: 1, locked: false, ...position });
      this.#renderLocations();
      this.#sync();
    } catch (error) {
      console.error(`${MODULE_ID} |`, error);
      ui.notifications.error(error.message);
    }
  }

  #viewportCenter() {
    const width = Math.max(1, this.viewport.clientWidth);
    const height = Math.max(1, this.viewport.clientHeight);
    return {
      x: clamp(((width / 2 - this.state.panX) / (width * this.state.zoom)) * 100, 0, 100),
      y: clamp(((height / 2 - this.state.panY) / (height * this.state.zoom)) * 100, 0, 100)
    };
  }

  async #openLocation(id) {
    const location = this.state.locations.find((entry) => entry.id === id);
    if (!location?.uuid) return;
    try {
      const page = await fromUuid(location.uuid);
      const valid = page?.documentName === "JournalEntryPage"
        && page.getFlag(MODULE_ID, FLAGS.TYPE) === DOCUMENT_TYPES.RESOURCE
        && ResourceService.getData(page).kind === "place";
      if (!valid) throw new Error(game.i18n.localize("DMJ.CityMap.LocationMissing"));
      await this.openResource?.(page);
    } catch (error) {
      console.warn(`${MODULE_ID} |`, error);
      ui.notifications.warn(error.message || game.i18n.localize("DMJ.CityMap.LocationMissing"));
    }
  }

  #onPointerDown(event) {
    const resizeHandle = event.target.closest("[data-action='resize-city-location']");
    if (resizeHandle) {
      if (event.button !== 0) return;
      const marker = resizeHandle.closest("[data-city-location]");
      const location = this.state.locations.find((entry) => entry.id === marker?.dataset.cityLocation);
      if (!marker || !location || location.locked) return;
      this.locationResize = {
        pointerId: event.pointerId,
        id: location.id,
        handle: resizeHandle,
        startX: event.clientX,
        startSize: location.size,
        moved: false
      };
      resizeHandle.setPointerCapture?.(event.pointerId);
      marker.classList.add("resizing");
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const dragHandle = event.target.closest("[data-action='drag-city-location']");
    if (dragHandle) {
      if (event.button !== 0) return;
      const marker = dragHandle.closest("[data-city-location]");
      const location = this.state.locations.find((entry) => entry.id === marker?.dataset.cityLocation);
      if (!marker || !location || location.locked) return;
      this.locationDrag = { pointerId: event.pointerId, id: marker.dataset.cityLocation, handle: dragHandle };
      dragHandle.setPointerCapture?.(event.pointerId);
      marker.classList.add("dragging");
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.target.closest("button, [data-city-location]")) return;
    if (!this.viewport.contains(event.target) || event.button !== 0) return;
    this.panState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      panX: this.state.panX,
      panY: this.state.panY
    };
    this.viewport.setPointerCapture?.(event.pointerId);
    this.viewport.classList.add("panning");
    event.preventDefault();
  }

  #onPointerMove(event) {
    if (this.locationResize?.pointerId === event.pointerId) {
      const location = this.state.locations.find((entry) => entry.id === this.locationResize.id);
      if (!location) return;
      const delta = event.clientX - this.locationResize.startX;
      if (Math.abs(delta) > 2) this.locationResize.moved = true;
      location.size = clamp(Math.round((this.locationResize.startSize + delta / LOCATION_SIZE_DRAG_DISTANCE) * 100) / 100, LOCATION_SIZE_MIN, LOCATION_SIZE_MAX);
      this.locationLayer.querySelector(`[data-city-location="${location.id}"]`)?.style.setProperty("--dmj-city-location-scale", String(location.size));
      event.preventDefault();
      return;
    }
    if (this.locationDrag?.pointerId === event.pointerId) {
      const rect = this.stage.getBoundingClientRect();
      const location = this.state.locations.find((entry) => entry.id === this.locationDrag.id);
      if (!location || rect.width <= 0 || rect.height <= 0) return;
      location.x = clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100);
      location.y = clamp(((event.clientY - rect.top) / rect.height) * 100, 0, 100);
      const marker = this.locationLayer.querySelector(`[data-city-location="${location.id}"]`);
      if (marker) {
        marker.style.left = `${location.x}%`;
        marker.style.top = `${location.y}%`;
      }
      event.preventDefault();
      return;
    }
    if (this.panState?.pointerId !== event.pointerId) return;
    this.state.panX = this.panState.panX + event.clientX - this.panState.startX;
    this.state.panY = this.panState.panY + event.clientY - this.panState.startY;
    this.#applyTransform();
    event.preventDefault();
  }

  #onPointerUp(event) {
    if (this.locationResize?.pointerId === event.pointerId) {
      if (this.locationResize.handle.hasPointerCapture?.(event.pointerId)) this.locationResize.handle.releasePointerCapture(event.pointerId);
      this.locationLayer.querySelector(`[data-city-location="${this.locationResize.id}"]`)?.classList.remove("resizing");
      this.ignoreResizeClick = this.locationResize.moved ? this.locationResize.id : null;
      const resizedId = this.ignoreResizeClick;
      if (resizedId) {
        getElementWindow(this.root).setTimeout(() => {
          if (this.ignoreResizeClick === resizedId) this.ignoreResizeClick = null;
        }, 0);
      }
      this.locationResize = null;
      this.#sync();
      return;
    }
    if (this.locationDrag?.pointerId === event.pointerId) {
      if (this.locationDrag.handle.hasPointerCapture?.(event.pointerId)) this.locationDrag.handle.releasePointerCapture(event.pointerId);
      this.locationLayer.querySelector(`[data-city-location="${this.locationDrag.id}"]`)?.classList.remove("dragging");
      this.locationDrag = null;
      this.#sync();
      return;
    }
    if (this.panState?.pointerId !== event.pointerId) return;
    if (this.viewport.hasPointerCapture?.(event.pointerId)) this.viewport.releasePointerCapture(event.pointerId);
    this.viewport.classList.remove("panning");
    this.panState = null;
    this.#sync();
  }

  #onWheel(event) {
    event.preventDefault();
    const rect = this.viewport.getBoundingClientRect();
    const pointX = event.clientX - rect.left;
    const pointY = event.clientY - rect.top;
    const oldZoom = this.state.zoom;
    const factor = event.deltaY < 0 ? 1.1 : 0.9;
    const newZoom = clamp(oldZoom * factor, 0.5, 3);
    const ratio = newZoom / oldZoom;
    this.state.panX = pointX - (pointX - this.state.panX) * ratio;
    this.state.panY = pointY - (pointY - this.state.panY) * ratio;
    this.state.zoom = newZoom;
    this.#sync();
  }

  #onKeyDown(event) {
    const movement = 30;
    let handled = true;
    if (event.key === "ArrowLeft") this.state.panX += movement;
    else if (event.key === "ArrowRight") this.state.panX -= movement;
    else if (event.key === "ArrowUp") this.state.panY += movement;
    else if (event.key === "ArrowDown") this.state.panY -= movement;
    else if (["+", "="].includes(event.key)) this.state.zoom = clamp(this.state.zoom * 1.1, 0.5, 3);
    else if (event.key === "-") this.state.zoom = clamp(this.state.zoom * 0.9, 0.5, 3);
    else if (event.key === "0") {
      this.state.panX = 0;
      this.state.panY = 0;
      this.state.zoom = 1;
    } else handled = false;
    if (!handled) return;
    event.preventDefault();
    this.#sync();
  }
}
