import type { AppDispatch, PulseStore, RootState } from "@pulsedesk/state";
import { useDispatch, useSelector, useStore } from "react-redux";

export const useAppSelector = useSelector.withTypes<RootState>();
export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppStore = useStore.withTypes<PulseStore>();
