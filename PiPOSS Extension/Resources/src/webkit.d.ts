/**
 * WebKit-specific type definitions for Safari
 * @see https://developer.apple.com/documentation/webkitjs
 */

/** @see https://developer.apple.com/documentation/webkitjs/htmlvideoelement/1631913-webkitpresentationmode */
type VideoPresentationMode = 'inline' | 'picture-in-picture' | 'fullscreen';

/**
 * WebKit extensions to HTMLVideoElement
 * @see https://developer.apple.com/documentation/webkitjs/htmlvideoelement
 */
interface HTMLVideoElement {
  /** Checks whether the video element supports a presentation mode */
  webkitSupportsPresentationMode(mode: VideoPresentationMode): boolean;

  /** The current presentation mode for video playback */
  webkitPresentationMode: VideoPresentationMode;

  /** Sets the presentation mode for video playback */
  webkitSetPresentationMode(mode: VideoPresentationMode): void;
}

/**
 * Browser extension API types
 * @see https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions
 */
declare namespace browser {
  namespace commands {
    const onCommand: {
      addListener(callback: (command: string) => void): void;
    };
  }

  namespace tabs {
    interface Tab {
      id?: number;
      active?: boolean;
      url?: string;
    }

    interface QueryInfo {
      active?: boolean;
      currentWindow?: boolean;
    }

    function query(queryInfo: QueryInfo): Promise<Tab[]>;
    function sendMessage(tabId: number, message: any): Promise<any>;
  }

  namespace runtime {
    const onMessage: {
      addListener(callback: (message: any, sender: any, sendResponse: (response?: any) => void) => void | boolean): void;
    };
  }
}
