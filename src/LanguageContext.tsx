import { createContext, useContext } from "react";
import type { Language } from "../shared/languages";

export const LanguageContext = createContext<{ language: Language; pinyin: boolean }>({
  language: "id",
  pinyin: true,
});
export const useLanguage = () => useContext(LanguageContext);
