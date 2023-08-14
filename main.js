
const { app, Tray, Menu, nativeImage, BrowserWindow, ipcMain, Notification, MessageChannelMain, utilityProcess } = require('electron');
const path = require('path');

const os = require('os');
const fs = require('fs');

const { Tail } = require('tail');
const chokidar = require('chokidar');

if (require('electron-squirrel-startup')) app.quit();

require('update-electron-app')();

const gotTheLock = app.requestSingleInstanceLock();
let win

// Sets the protocol for ED Squadrone Tracker
if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('ed-squadrone-tracker', process.execPath, [path.resolve(process.argv[1])])
    }
  } else {
    app.setAsDefaultProtocolClient('ed-squadrone-tracker')
  }

// Checks if the App is the first/only instance of it
if (!gotTheLock) {
    app.quit()
} else {
    // Handler if a second instance was opened
    app.on('second-instance', (event, commandLine, workingDirectory) => {

        if (win) {
            if(win.isMinimized()) win.restore()
            win.focus()
        }

        // Just for debug rightnow, as protocol handling ist still being added
        console.log(commandLine.pop())

    })
}

// Get the latest journal file
journalPath = path.join(os.homedir(), 'Saved Games/Frontier Developments/Elite Dangerous');

filesFound = false
var tail;

// Function for loading the latest Journal
function loadJournal() {
    try {

        // Tries to find the latest Journal
        files = fs.readdirSync(journalPath)
    
        files = files.filter(e => e.startsWith('Journal.'))
        files.sort();
        files.reverse();
        if (tail) {
            tail.unwatch();
        }
        
        // Creates a new Tail for the latest Journal
        tail = new Tail(path.join(journalPath, files[0]));

        // A new event occured in the journal
        tail.on('line', (data) => {
            jsonData = JSON.parse(data)

            // Send the event to the frontend, whatever event occured
            win.webContents.send('journal-event', jsonData)

            console.log(jsonData.event);

            // Handler if "Docked" event occured
            if (jsonData.event === "Docked") {
                win.webContents.send('journal-event-Docked', jsonData) // Send "Docked" event to the frontend

                // Send a notification about the docking
                // TODO Implement "windows-notification-state" for checking if the notification would be visible
                // TODO Implement "electron-windows-notifications" and "electron-windows-interactive-notifications" for better notifications
                new Notification({
                    toastXml: `
                    <toast launch="ed-squadrone-tracker:action=station&amp;marketId=${jsonData.MarketID}" activationType="protocol">
                        <visual>
                            <binding template="ToastGeneric">
                                <text>ED Squadrone Tracker</text>
                                <text>Docked at ${jsonData.StationName}</text>
                            </binding>
                        </visual>
                        <actions>
                            <action
                                content="Open in App"
                                arguments="ed-squadrone-tracker:action=viewDetails&amp;contentId=351"
                                activationType="protocol"/>
    
                            <action
                                content="Open on Inara"
                                arguments="ed-squadrone-tracker:action=remindlater&amp;contentId=351"
                                activationType="protocol"/>
                        </actions>
                    </toast>`
                }).show()
            }

        })
    
        return true;
    
    } catch (error) {
        //if (error.code === 'ENOENT') {
        return false
    }
}

// This function is used to create a Utility Process which is being used to create a local webserver for Streamers
// Streamers are able to add live updated data to their stream, like current ship, position, group, system, station, etc.
// The webservers script can be found in streamserver.js
function createWebServerProcess() {
    const { port1, port2 } = new MessageChannelMain()
    const child = utilityProcess.fork(path.join(__dirname, 'streamserver.js'))

    return child
}

// Loads the latest journal
try {
    filesFound = loadJournal();

    // Add a directory watcher that reloads the journal (if app is running overnight or 500k events have been reached)
    const JournalPathWatcher = chokidar.watch('.', {
        cwd: journalPath
    });
    JournalPathWatcher.on('add', (path) => {
        console.log(path)
        if (path.startsWith('Journal.')) {
            loadJournal()
        }
    })
} catch (error) {
    filesFound = false;
}



// Set User tasks
app.setUserTasks([
    {
        program: process.execPath,
        arguments: '--new-window',
        iconPath: process.execPath,
        iconIndex: 0,
        title: "New Window",
        description: "Create a new Window"
    }
])

// Sets the app's about menu
app.setAboutPanelOptions({
    applicationName: 'ED Squadrone Tracker',
    applicationVersion: 'V0.0.2',
    copyright: 'Copyright 2023 Kejax & Fliegevieh',
    website: 'https://github.com/Kejax/ED-Squadrone-Tracker'
})

// Function to create and load the default window
const createWindow = () => {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        icon: 'icon.ico',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js')
        },
        titleBarOverlay: {
            color: "#0000FF00",
            height: 50
        }
    })

    win.on('close', (event) => {
        win.hide();
        event.preventDefault();
    })

    win.loadFile('pages/index.html')

    return win
}

// App on ready listener, waits untill the app is ready
if (gotTheLock) {
    app.on('ready', () => {

        console.log('Ready');

        // Sets if the files for events were found
        ipcMain.on('journal-files-found', () => {return filesFound});

        // Create a tray with the icon 'tray.png'
        const icon = nativeImage.createFromPath(path.join(__dirname, 'tray_icon.png'));
        tray = new Tray(icon);

        // Add window show functionality on double click tray
        tray.on('double-click', (event, bounds) => {
            if (BrowserWindow.getAllWindows().length === 0) {win = createWindow(); console.log("TEST")}
            else win.show()
        })

        // Creates the contextmenu for the tray
        const contextMenu = Menu.buildFromTemplate([
            { label: 'EDDB', type: 'normal' , enabled: false, icon: icon, },
            { label: "About", type: 'normal', role: 'about' },
            { type: 'separator'},
            { label: 'Quit EDDB', type: 'normal', click: () => {
                win.destroy();
                app.quit()
            } },
        ])

        // Sets the contextmenu for the tray
        tray.setContextMenu(contextMenu);
        tray.description = "EDDB"
        
        // IPC Handling between renderer and main
        ipcMain.handle('ping', () => icon.toBitmap()); // Just for fun and such

        // Calls our function to create a window
        win = createWindow();

        // MacOS functionality to create a window if none exists
        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) win = createWindow()
        })

        // Streaming Webserver
        const webServer = createWebServerProcess();

        webServer.on('message', (message) => {console.log(message)})

        webServer.postMessage({ message: 'hello' })

        // TODO Test/Debug area
        

    })
}

// Prevents the app from quitting when all windows have been closed
app.on('window-all-closed', e => e.preventDefault() )