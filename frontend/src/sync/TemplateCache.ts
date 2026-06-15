export class TemplateCache {
  private static DB_NAME = "PrismTemplateCache";
  private static STORE_NAME = "templates";

  private static getDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          db.createObjectStore(this.STORE_NAME, { keyPath: "themeHash" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  static async get(themeHash: string): Promise<ArrayBuffer | null> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(this.STORE_NAME, "readonly");
        const store = transaction.objectStore(this.STORE_NAME);
        const request = store.get(themeHash);
        request.onsuccess = () => {
          resolve(request.result ? request.result.docxBlob : null);
        };
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.error("TemplateCache get failed:", err);
      return null;
    }
  }

  static async set(themeHash: string, docxBlob: ArrayBuffer): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(this.STORE_NAME, "readwrite");
        const store = transaction.objectStore(this.STORE_NAME);
        const request = store.put({ themeHash, docxBlob });
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.error("TemplateCache set failed:", err);
    }
  }
}
