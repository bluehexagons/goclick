import { required as $ } from "./dom.js";
import { currentLanguage, formatPercent, formatUnit, message as t } from "./i18n.js";
import { gameSettings, isSimulatedPing } from "./preferences.js";
import { clickSound } from "./sound.js";
import { isSoundProfile, soundProfiles } from "./sound-design.js";

export function bindOptionPreferences(
  saveOption: (patch: Parameters<typeof gameSettings.update>[0]) => void,
) {
  const motionSetting = $<HTMLSelectElement>("#motion-setting");
  const simulatedPingSetting = $<HTMLSelectElement>("#simulated-ping");
  const soundToggle = $<HTMLButtonElement>("#sound-toggle");
  const soundEnabled = $<HTMLInputElement>("#sound-enabled");
  const soundVolumeSetting = $<HTMLInputElement>("#sound-volume");
  const soundVolumeValue = $("#sound-volume-value");
  const soundReverbSetting = $<HTMLInputElement>("#sound-reverb");
  const soundProfileSetting = $<HTMLSelectElement>("#sound-profile");
  const soundProfileDescription = $("#sound-profile-description");
  const soundPreview = $<HTMLButtonElement>("#preview-sound");
  const profileOptions = soundProfiles.map((profile) => {
    const option = document.createElement("option");
    option.value = profile.id;
    soundProfileSetting.append(option);
    return { option, name: profile.name };
  });
  function paintSoundVolume(percent: number) {
    const text = formatPercent(percent / 100);
    soundVolumeValue.textContent = text;
    soundVolumeSetting.setAttribute("aria-valuetext", text);
  }
  function paintSoundLabels() {
    paintSoundVolume(soundVolumeSetting.valueAsNumber);
    soundProfileDescription.textContent = t(
      soundProfiles.find((profile) => profile.id === soundProfileSetting.value)!.description,
    );
    soundToggle.setAttribute("aria-label", t("sound"));
    soundToggle.title = t(soundEnabled.checked ? "soundOn" : "soundOff");
    soundToggle.lang = currentLanguage();
  }
  function updateSoundOptions() {
    const { sound: enabled, soundProfile, soundVolume, soundReverb } = gameSettings.value;
    clickSound.setProfile(soundProfile);
    clickSound.setVolume(soundVolume / 100);
    clickSound.setReverb(soundReverb);
    clickSound.setEnabled(enabled);
    soundEnabled.checked = enabled;
    soundVolumeSetting.value = String(soundVolume);
    soundReverbSetting.checked = soundReverb;
    soundProfileSetting.value = soundProfile;
    soundPreview.disabled = !enabled;
    soundToggle.setAttribute("aria-pressed", String(enabled));
    paintSoundLabels();
  }
  gameSettings.onChange(updateSoundOptions);
  updateSoundOptions();
  soundToggle.addEventListener("click", () => {
    try {
      gameSettings.update({ sound: !gameSettings.value.sound });
    } catch {
      // Like motion, sound still applies for this visit if storage is blocked.
    }
    // Unlock and start the device during explicit opt-in, before the first game
    // press. Startup and stored preferences remain silent and allocation-free.
    if (gameSettings.value.sound) clickSound.prepare();
  });

  function paintOptionLabels() {
    for (const { option, name } of profileOptions) option.textContent = t(name);
    for (const option of simulatedPingSetting.querySelectorAll<HTMLOptionElement>("[data-ping]"))
      option.textContent = t("approximatePing", {
        time: formatUnit(Number(option.value), "millisecond"),
      });
  }
  function updatePlayOptions() {
    const { motion, simulatedPing } = gameSettings.value;
    motionSetting.value = motion;
    simulatedPingSetting.value = String(simulatedPing);
  }
  gameSettings.onChange(updatePlayOptions);
  updatePlayOptions();

  soundEnabled.addEventListener("change", () => {
    saveOption({ sound: soundEnabled.checked });
    if (gameSettings.value.sound) clickSound.prepare();
  });
  soundVolumeSetting.addEventListener("input", () => {
    paintSoundVolume(soundVolumeSetting.valueAsNumber);
    clickSound.setVolume(soundVolumeSetting.valueAsNumber / 100);
  });
  soundVolumeSetting.addEventListener("change", () => {
    saveOption({ soundVolume: soundVolumeSetting.valueAsNumber });
  });
  soundReverbSetting.addEventListener("change", () => {
    saveOption({ soundReverb: soundReverbSetting.checked });
  });
  soundProfileSetting.addEventListener("change", () => {
    const profile = soundProfileSetting.value;
    if (isSoundProfile(profile)) saveOption({ soundProfile: profile });
  });
  soundPreview.addEventListener("click", () => clickSound.preview());
  motionSetting.addEventListener("change", () => {
    const motion = motionSetting.value;
    if (motion === "auto" || motion === "on" || motion === "off") saveOption({ motion });
  });
  simulatedPingSetting.addEventListener("change", () => {
    const simulatedPing = Number(simulatedPingSetting.value);
    if (isSimulatedPing(simulatedPing)) saveOption({ simulatedPing });
  });

  return () => {
    paintOptionLabels();
    paintSoundLabels();
  };
}
