#[cfg(windows)]
use std::time::Duration;

#[cfg(windows)]
use std::sync::{
    atomic::{AtomicU32, Ordering},
    Mutex, OnceLock,
};

#[cfg(windows)]
use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_TRANSITIONS_FORCEDISABLED};

#[cfg(windows)]
const DWM_TRANSITION_LEASE_TIMEOUT: Duration = Duration::from_millis(2500);

// Win11 can animate the native fullscreen style change after the WebView has
// already entered its visual blur. Keep DWM suppression scoped to this lease
// so normal window transitions remain unchanged.
#[cfg(windows)]
struct DwmTransitionGuard {
    hwnd: isize,
    active: bool,
}

#[cfg(windows)]
impl DwmTransitionGuard {
    fn acquire(hwnd: windows::Win32::Foundation::HWND) -> Result<Self, String> {
        disable_dwm_transitions(hwnd)?;
        Ok(Self {
            hwnd: hwnd.0 as isize,
            active: true,
        })
    }

    fn restore(&mut self) -> Result<(), String> {
        if !self.active {
            return Ok(());
        }

        let hwnd = windows::Win32::Foundation::HWND(self.hwnd as *mut std::ffi::c_void);
        enable_dwm_transitions(hwnd)?;
        self.active = false;
        Ok(())
    }
}

#[cfg(windows)]
impl Drop for DwmTransitionGuard {
    fn drop(&mut self) {
        if self.active {
            let hwnd = windows::Win32::Foundation::HWND(self.hwnd as *mut std::ffi::c_void);
            if let Err(err) = enable_dwm_transitions(hwnd) {
                eprintln!("failed to restore DWM transitions: {err}");
            }
        }
    }
}

#[cfg(windows)]
struct ActiveLease {
    id: u32,
    guard: DwmTransitionGuard,
}

#[cfg(windows)]
static ACTIVE_LEASE: OnceLock<Mutex<Option<ActiveLease>>> = OnceLock::new();

#[cfg(windows)]
static NEXT_LEASE_ID: AtomicU32 = AtomicU32::new(1);

#[cfg(windows)]
fn active_lease() -> &'static Mutex<Option<ActiveLease>> {
    ACTIVE_LEASE.get_or_init(|| Mutex::new(None))
}

#[cfg(windows)]
fn next_lease_id() -> u32 {
    let id = NEXT_LEASE_ID.fetch_add(1, Ordering::Relaxed);
    if id == 0 {
        NEXT_LEASE_ID.fetch_add(1, Ordering::Relaxed)
    } else {
        id
    }
}

#[cfg(windows)]
fn expire_lease(id: u32) {
    let expired = match active_lease().lock() {
        Ok(mut lease) if lease.as_ref().is_some_and(|active| active.id == id) => lease.take(),
        Ok(_) => None,
        Err(err) => {
            eprintln!("failed to lock DWM transition lease for expiry: {err}");
            None
        }
    };
    drop(expired);
}

#[cfg(windows)]
pub(crate) fn disable_dwm_transitions(
    hwnd: windows::Win32::Foundation::HWND,
) -> Result<(), String> {
    set_dwm_transitions(hwnd, true)
}

#[cfg(windows)]
pub(crate) fn enable_dwm_transitions(hwnd: windows::Win32::Foundation::HWND) -> Result<(), String> {
    set_dwm_transitions(hwnd, false)
}

#[cfg(windows)]
fn set_dwm_transitions(
    hwnd: windows::Win32::Foundation::HWND,
    disabled: bool,
) -> Result<(), String> {
    let value: i32 = if disabled { 1 } else { 0 };
    unsafe {
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_TRANSITIONS_FORCEDISABLED,
            (&value as *const i32).cast(),
            std::mem::size_of::<i32>() as u32,
        )
    }
    .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn begin_fullscreen_dwm_transition(
    window: tauri::WebviewWindow,
) -> Result<Option<u32>, String> {
    #[cfg(windows)]
    {
        let hwnd = window
            .hwnd()
            .map_err(|err| format!("failed to get main window HWND: {err}"))?;
        let mut active = active_lease()
            .lock()
            .map_err(|err| format!("failed to lock DWM transition lease: {err}"))?;

        if let Some(mut previous) = active.take() {
            previous
                .guard
                .restore()
                .map_err(|err| format!("failed to restore previous DWM transition lease: {err}"))?;
        }

        let guard = DwmTransitionGuard::acquire(hwnd)?;
        let id = next_lease_id();
        *active = Some(ActiveLease { id, guard });
        drop(active);

        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(DWM_TRANSITION_LEASE_TIMEOUT).await;
            expire_lease(id);
        });

        Ok(Some(id))
    }

    #[cfg(not(windows))]
    {
        let _ = window;
        Ok(None)
    }
}

#[tauri::command]
pub fn end_fullscreen_dwm_transition(lease_id: u32) -> Result<(), String> {
    #[cfg(windows)]
    {
        let mut active = active_lease()
            .lock()
            .map_err(|err| format!("failed to lock DWM transition lease: {err}"))?;
        if !active.as_ref().is_some_and(|lease| lease.id == lease_id) {
            return Ok(());
        }

        let mut lease = active.take().expect("DWM transition lease was checked");
        if let Err(err) = lease.guard.restore() {
            *active = Some(lease);
            return Err(format!("failed to restore DWM transitions: {err}"));
        }
        Ok(())
    }

    #[cfg(not(windows))]
    {
        let _ = lease_id;
        Ok(())
    }
}
