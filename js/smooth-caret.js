/**
 * Smooth Caret Lib - 丝滑光标插件
 * 功能：自动为带 .smooth-caret 类的元素添加平滑动画光标
 * 支持：input, textarea, contentEditable
 * 特性：支持动态 DOM 监测 (MutationObserver)
 */
(function () {
  const STYLE_ID = "smooth-caret-styles";

  // 1. 注入全局样式
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
            .smooth-caret-cursor {
                position: absolute;
                pointer-events: none;
                width: 2px;
                background-color: #3b82f6;
                border-radius: 2px;
                z-index: 10000;
                box-shadow: 0 0 8px rgba(59, 130, 246, 0.6);
                transition: left 0.15s ease-out, top 0.15s ease-out, opacity 0.15s ease-out;
                will-change: left, top, opacity;
            }
            @keyframes smooth-caret-blink {
                0%, 45% { opacity: 1; }
                50%, 95% { opacity: 0; }
                100% { opacity: 1; }
            }
            .smooth-caret-blinking {
                animation: smooth-caret-blink 1s step-end infinite !important;
            }
        `;
    document.head.appendChild(style);
  }

  class SmoothCaret {
    constructor(el) {
      this.el = el;
      this.isContentEditable =
        el.contentEditable === "true" || el.tagName === "BODY";
      this.cursor = this.createCursor();
      this.mirror = !this.isContentEditable ? this.createMirror() : null;
      this.typingTimer = null;
      this.isTyping = false;

      this.init();
    }

    createCursor() {
      const cursor = document.createElement("div");
      cursor.className = "smooth-caret-cursor";
      cursor.style.opacity = "0";
      cursor.style.visibility = "hidden";
      document.body.appendChild(cursor);
      return cursor;
    }

    createMirror() {
      const mirror = document.createElement("div");
      mirror.style.position = "absolute";
      mirror.style.visibility = "hidden";
      mirror.style.pointerEvents = "none";
      mirror.style.whiteSpace = "pre-wrap";
      mirror.style.wordBreak = "break-word";
      mirror.style.opacity = "0";
      document.body.appendChild(mirror);
      return mirror;
    }

    syncMirrorStyles() {
      if (!this.mirror) return;
      const style = window.getComputedStyle(this.el);
      const props = [
        "fontFamily",
        "fontSize",
        "fontWeight",
        "lineHeight",
        "paddingTop",
        "paddingRight",
        "paddingBottom",
        "paddingLeft",
        "borderWidth",
        "boxSizing",
        "letterSpacing",
        "textTransform",
        "textAlign",
      ];
      props.forEach((p) => (this.mirror.style[p] = style[p]));
      this.mirror.style.width = style.width;
    }

    update() {
      let x = 0,
        y = 0,
        h = 0;

      if (this.isContentEditable) {
        const selection = window.getSelection();
        if (!selection.rangeCount) return;
        const range = selection.getRangeAt(0).cloneRange();

        if (this.el.innerHTML.trim() === "" || this.el.textContent === "") {
          const rect = this.el.getBoundingClientRect();
          const style = window.getComputedStyle(this.el);
          x = rect.left + parseFloat(style.paddingLeft);
          y = rect.top + parseFloat(style.paddingTop);
          h = parseFloat(style.fontSize) * 1.2;
        } else {
          const rects = range.getClientRects();
          const rect =
            rects.length > 0 ? rects[0] : range.getBoundingClientRect();
          x = rect.left;
          y = rect.top;
          h =
            rect.height ||
            parseFloat(window.getComputedStyle(this.el).fontSize) * 1.2;
        }
      } else {
        this.syncMirrorStyles();
        const start = this.el.selectionStart;
        const value = this.el.value;

        const textBefore = value.substring(0, start);
        this.mirror.textContent = textBefore;

        const marker = document.createElement("span");
        marker.textContent = "\u200b";
        this.mirror.appendChild(marker);

        const elRect = this.el.getBoundingClientRect();
        const markerPos = marker.getBoundingClientRect();
        const mirrorRect = this.mirror.getBoundingClientRect();

        x =
          elRect.left + (markerPos.left - mirrorRect.left) - this.el.scrollLeft;
        y = elRect.top + (markerPos.top - mirrorRect.top) - this.el.scrollTop;
        h =
          markerPos.height ||
          parseFloat(window.getComputedStyle(this.el).fontSize) * 1.2;
      }

      const isSelecting = this.isContentEditable
        ? !window.getSelection().isCollapsed
        : this.el.selectionStart !== this.el.selectionEnd;

      if (isSelecting) {
        this.cursor.style.visibility = "hidden";
      } else {
        this.cursor.style.visibility = "visible";
        this.cursor.style.left = `${x + window.scrollX}px`;
        this.cursor.style.top = `${y + window.scrollY}px`;
        this.cursor.style.height = `${h}px`;
        this.cursor.style.transform = `translateY(0.1em)`;
      }
    }

    handleTyping() {
      this.isTyping = true;
      this.cursor.classList.remove("smooth-caret-blinking");
      this.cursor.style.opacity = "1";

      clearTimeout(this.typingTimer);
      this.typingTimer = setTimeout(() => {
        this.isTyping = false;
        if (document.activeElement === this.el) {
          this.cursor.classList.add("smooth-caret-blinking");
        }
      }, 500);
    }

    init() {
      this.el.style.caretColor = "transparent";

      const events = [
        "input",
        "click",
        "keyup",
        "keydown",
        "focus",
        "blur",
        "mousedown",
        "scroll",
      ];
      events.forEach((ev) => {
        this.el.addEventListener(ev, (e) => {
          if (ev === "keydown") this.handleTyping();
          if (ev === "focus") {
            this.cursor.style.opacity = "1";
            this.cursor.classList.add("smooth-caret-blinking");
          }
          if (ev === "blur") {
            this.cursor.style.opacity = "0";
            this.cursor.classList.remove("smooth-caret-blinking");
          }

          if (ev === "mousedown") {
            const moveHandler = () => this.update();
            const upHandler = () => {
              window.removeEventListener("mousemove", moveHandler);
              window.removeEventListener("mouseup", upHandler);
            };
            window.addEventListener("mousemove", moveHandler);
            window.addEventListener("mouseup", upHandler);
          }

          requestAnimationFrame(() => this.update());
        });
      });

      this.update();
    }
  }

  // 扫描并初始化特定元素
  function scanAndInit(root = document) {
    const elements = root.querySelectorAll(".smooth-caret");
    elements.forEach((el) => {
      if (!el._smoothCaretInstance) {
        el._smoothCaretInstance = new SmoothCaret(el);
      }
    });
  }

  // 设置自动监听监听
  function setupObserver() {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          // 检查节点本身是否符合
          if (node.nodeType === 1) {
            if (node.classList.contains("smooth-caret")) {
              if (!node._smoothCaretInstance)
                node._smoothCaretInstance = new SmoothCaret(node);
            }
            // 检查子节点
            scanAndInit(node);
          }
        });
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  // 启动流程
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      scanAndInit();
      setupObserver();
    });
  } else {
    scanAndInit();
    setupObserver();
  }

  window.initSmoothCaret = scanAndInit;
})();
