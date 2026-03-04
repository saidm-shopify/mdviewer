/**
 * Quick Database Fallback for Local Development
 * Provides a localStorage-based fallback when quick.db is not available
 */

function generateUUID() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

if (typeof quick === "undefined") {
  console.log("[FALLBACK] Quick API not available - using localStorage fallback");

  window.quick = {
    id: {
      async waitForUser() {
        return {
          email: "local.dev@shopify.com",
          fullName: "Local Developer",
          slackImageUrl: "",
        };
      },
    },
    db: {
      async get(key) {
        try {
          const data = localStorage.getItem(`quick_db_${key}`);
          return data ? JSON.parse(data) : null;
        } catch (error) {
          console.error("Error reading from localStorage:", error);
          return null;
        }
      },

      async set(key, value) {
        try {
          localStorage.setItem(`quick_db_${key}`, JSON.stringify(value));
          return true;
        } catch (error) {
          console.error("Error saving to localStorage:", error);
          return false;
        }
      },

      collection(name) {
        return {
          async find() {
            const data = await window.quick.db.get(name);
            return data || [];
          },

          async findById(id) {
            const items = await this.find();
            return items.find((item) => item.id === id) || null;
          },

          async create(data) {
            const items = await this.find();
            const newItem = {
              id: generateUUID(),
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              ...data,
            };
            items.push(newItem);
            await window.quick.db.set(name, items);
            return newItem;
          },

          async update(id, updateData) {
            const items = await this.find();
            const index = items.findIndex((item) => item.id === id);
            if (index === -1) return null;
            items[index] = {
              ...items[index],
              ...updateData,
              updated_at: new Date().toISOString(),
            };
            await window.quick.db.set(name, items);
            return items[index];
          },

          async delete(id) {
            const items = await this.find();
            const filtered = items.filter((item) => item.id !== id);
            await window.quick.db.set(name, filtered);
            return filtered.length < items.length;
          },
        };
      },
    },
  };
}
