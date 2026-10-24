import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  // DenPosIcons = folder aset publik (favicon, logo, ikon PWA/Android).
  // Semua file di dalamnya di-copy apa adanya ke root dist sehingga bisa
  // direferensikan dari index.html dan ikut terbawa ke aset WebView Android.
  publicDir: "DenPosIcons",
  build: {
    outDir: "dist",
    rollupOptions: {
      output: {
        // Pisahkan React dari kode aplikasi: chunk vendor jarang berubah
        // sehingga cache-nya lebih awet dan chunk aplikasi lebih kecil.
        manualChunks: {
          "react-vendor": ["react", "react-dom"],
        },
      },
    },
  },
});
