// ==UserScript==
// @name         Rank Stekkies
// @namespace    https://orwa.tech/
// @version      0.0.3
// @description  Add ranking to stekkies
// @author       Orwa Diraneyya
// @match        https://www.stekkies.com/en/profiles/matches/*
// @icon         https://www.stekkies.com/static/roomraider/img/favicon.png
// @require      https://unpkg.com/leaflet@1.9.4/dist/leaflet.js
// @resource     leafletCSS https://unpkg.com/leaflet@1.9.4/dist/leaflet.css
// @updateURL    https://diraneyya.github.io/stekkies-tampermonkey/index.tampermonkey.js
// @downloadURL  https://diraneyya.github.io/stekkies-tampermonkey/index.tampermonkey.js
// @connect      maps.googleapis.com
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_getResourceText
// @run-at       document-start
// ==/UserScript==

(async function() {
    'use strict';

    let MAPS_API_KEY = GM_getValue('googleMapsApiKey', '');
    if (!MAPS_API_KEY) {
        MAPS_API_KEY = prompt('Enter your Google Maps API key:');
        GM_setValue('googleMapsApiKey', MAPS_API_KEY);
    }
    if (!MAPS_API_KEY) {
        console.info(`🤖 Stekkies UI improvement did not load. Need an API key`);
        return ;
    } else {
        console.info(`Google Maps API key loaded successfully...`)
    }

    // or if testing in node.js use this:
    // const gmFetch = async (url) => await (await fetch(url)).json()
    function gmFetch(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                onload: (response) => resolve(JSON.parse(response.responseText)),
                onerror: (error) => reject(error),
            });
        });
    }

    const selectStekkiesContainer = () => document.querySelector("#js-matches-results");
    const selectStekkie = n => document.querySelector(
        `#js-matches-results-inner > div:nth-child(${
        1 + Math.max(n, 0) * 5
        })`
    );
    // We are adding a button dynamically here to point to the map which is why we need last-child to make it
    // deterministic even after the addition. Additionally and because we are wrapping the buttons in a div we
    // need more flexibility in the expression which means we are substituting > with a space at the end
    const selectStekkieViewButton = n =>
    selectStekkie(n)?.querySelector(
            ':scope > div.px-2.flex-1.pr-\\[12px\\].pl-\\[12px\\].pb-\\[12px\\].flex.flex-col > div a:last-child'
    );
    const selectStekkieContainer = n =>
    selectStekkie(n)?.querySelector(
        ':scope > div.flex.flex-col.h-full.lg\\:cursor-pointer > div'
    );
    const selectAddressPriceContainer = n =>
    selectStekkieContainer(n)?.querySelector(
        ':scope > div.flex.justify-between'
    );
    const selectRoomAreaPortalContainer = n =>
    selectStekkieContainer(n)?.querySelector(
        ':scope > div.flex.gap-4.text-\\[var\\(--color-black\\)\\].text-sm'
    );
    const selectTagsContainer = n =>
    selectStekkieContainer(n)?.querySelector(
        ':scope > div.flex.gap-1\\.5.py-1.flex-wrap'
    );
    const getAddress = n =>
    selectAddressPriceContainer(n)?.querySelector(':scope > div > span')?.innerText;
    const getPrice = n =>
    selectAddressPriceContainer(n)?.querySelector(':scope > span')
    ?.innerText?.replace(/[^0-9.]/g,'');
    const getNumberRooms = n =>
    selectRoomAreaPortalContainer(n)?.querySelector(
        ':scope > div:nth-child(1)'
    )?.innerText;
    const getAreaM2 = n =>
    selectRoomAreaPortalContainer(n)?.querySelector(
        ':scope > div:nth-child(2)'
    )?.innerText;
    const getPortalName = n =>
    selectRoomAreaPortalContainer(n)?.querySelector(
        ':scope > a'
    )?.innerText;
    const getDirectLink = n =>
    selectRoomAreaPortalContainer(n)?.querySelector(
        ':scope > a'
    )?.href;

    const getTags = n => Array.from(
        selectTagsContainer(n)?.querySelectorAll(':scope > span') ?? []
    ).map(e => e.innerText);

    async function fetchDirectionsAPIResponse(homeLocation, bicycle = false) {
        const DIRECTIONS_ENDPOINT='https://maps.googleapis.com/maps/api/directions/json'
        const OFFICE_ADDRESS='Uber Amsterdam, Burgerweeshuispad, Amsterdam';

        const tuesday9AM = ((d) => {
            d.setDate(d.getDate() + (2 - d.getDay() + 7) % 7);
            return Math.floor(d.setHours(9) / 1000)
        })((new Date(new Date().toDateString())));

        const params = {
            key: MAPS_API_KEY,
            origin: homeLocation,
            destination: OFFICE_ADDRESS,
            ...(!bicycle ? {
                mode: 'transit',
                transit_routing_preference: 'fewer_transfers',
            } : {
                mode: 'bicycling'
            }),
            arrival_time: tuesday9AM
        };

        try {
            const response = await gmFetch(
                `${DIRECTIONS_ENDPOINT}?${new URLSearchParams(params)}`
            );
            if (response?.status === 'REQUEST_DENIED') {
                GM_setValue('googleMapsApiKey', '');
                const newKey = prompt('Google Maps API key is invalid or expired. Enter a new API key:');
                if (newKey) {
                    GM_setValue('googleMapsApiKey', newKey);
                    MAPS_API_KEY = newKey;
                    params.key = newKey;
                    return await gmFetch(`${DIRECTIONS_ENDPOINT}?${new URLSearchParams(params)}`);
                }
                throw 'API key rejected and no new key provided';
            }
            return response;
        } catch (e) {
            throw e || 'error fetching directions from Google';
        }
    }

    const COMMUTE_PAYLOAD_VERSION = 15;
    async function parseDirectionsAPIResponse(directions) {
        if (directions?.status !== 'OK' ||
            directions?.routes?.length !== 1 ||
            directions?.routes[0]?.legs?.length !== 1 ||
            directions?.geocoded_waypoints?.some(wp => wp.geocoder_status !== 'OK')) {
            return { version: COMMUTE_PAYLOAD_VERSION, success: false, error: directions?.status ?? 'UNKNOWN' };
        }

        const steps = directions.routes[0].legs[0].steps;
        // [
        //   [
        //     'WALKING',
        //     { text: '0.8 km', value: 778 },
        //     { text: '11 mins', value: 638 }
        //   ],
        //   [
        //     'BUS',
        //     { text: '9.3 km', value: 9305 },
        //     { text: '16 mins', value: 960 }
        //   ],
        //   [
        //     'WALKING',
        //     { text: '51 m', value: 51 },
        //     { text: '1 min', value: 43 }
        //   ],
        //   [
        //     'BUS',
        //     { text: '15.5 km', value: 15534 },
        //     { text: '25 mins', value: 1500 }
        //   ],
        //   [
        //     'WALKING',
        //     { text: '0.9 km', value: 852 },
        //     { text: '12 mins', value: 705 }
        //   ]
        // ]
        let step_summary = steps.map(s => [s?.transit_details?.line ?? s?.travel_mode, s?.distance, s?.duration])

        // The total walking distance on both ends in km
        const walking_distance = (step_summary.filter(([m]) => m === 'WALKING').map(s => s[1].value).reduce((sum, val) => sum + val, 0) / 1000).toFixed(1)
        // The total transit distance for gating the assessment of cyclability
        const transit_distance = (step_summary.filter(([m]) => m === 'TRANSIT').map(s => s[1].value).reduce((sum, val) => sum + val, 0) / 1000).toFixed(1)
        let cyclable = false;
        if (transit_distance < 10) {
            // investigate cyclability
            try {
                const cyclingDirections = await fetchDirectionsAPIResponse(`place_id:${directions.geocoded_waypoints[0].place_id}`, true);
                const cyclingDurationSeconds = cyclingDirections.routes[0].legs[0].duration.value;
                const cyclingDurationText = cyclingDirections.routes[0].legs[0].duration.text;
                if (cyclingDurationSeconds <= 45 * 60) {
                    cyclable = cyclingDurationText;
                    console.info(`🚲 Home address is cyclable!`)
                } else {
                    console.info(`🚳 Home address is NOT cyclable (${cyclingDurationText} > 45 min)`)
                }
            } catch (error) {
                // do nothing
                console.error('❌ failed to investigate cyclability for home address');
                console.error(`(exception caught: ${String(error).toUpperCase()})`);
            }
        }
        // The type of public transport along with the time it takes on the transport in minutes
        // Example: [ [ 'BUS', 16 ], [ 'BUS', 25 ] ]
        const transit_summary = step_summary.filter(([m]) => typeof(m) !== 'string').map(([m, _, t]) => [m, Math.round(t.value / 60)]);
        const transit_time = Math.round(transit_summary.reduce((sum, [_, t]) => sum + t, 0))

        return {
            version: COMMUTE_PAYLOAD_VERSION,
            success: true,
            walking_distance,
            transit_time,
            transit_count: transit_summary.length,
            transit_summary,
            cyclable,
            start: directions.routes[0].legs[0].start_location,
            end: directions.routes[0].legs[0].end_location,
        }
    }

    // Google directions API => parse => store in local storage, gated by version (cache)
    // retrieve from local storage => compatibel version? => post process to get line summary information
    function postProcessCommute(cachedCommute) {
        const postProcessLineInformation = line => {
            const vehicleName = line?.vehicle?.name;
            if ('Train' === vehicleName) { return line?.short_name }
            return vehicleName;
        };
        const postProcessedLines = cachedCommute.transit_summary.map(([line, _duration]) => postProcessLineInformation(line));
        cachedCommute.transit_modes = Array.from(new Set(postProcessedLines)).join('/')
        cachedCommute.transit_count = postProcessedLines.length;
        // delete cachedCommute.transit_summary;

        return cachedCommute;
    }

    async function getCommuteDetails(n) {
        const homeAddress = getAddress(n);
        if (!homeAddress) {
            return { success: false, error: 'address not found for stekkie #' + n }
        }

        try {
            let commuteDetails = localStorage.getItem(homeAddress);
            if (commuteDetails !== null) {
                try {
                    commuteDetails = JSON.parse(commuteDetails);
                } catch {
                    localStorage.removeItem(homeAddress);
                    commuteDetails = null;
                }
            }

            let updated = commuteDetails?.version > 0 && commuteDetails?.version !== COMMUTE_PAYLOAD_VERSION;
            let failed = commuteDetails?.success === false;
            let retry = failed && !updated ? commuteDetails?.retries ?? 0 : 0;
            if (commuteDetails === null || updated || (failed && 1 + retry <= 3)) {
                console.log(`seeking directions from API for ${homeAddress}${failed && !updated ? ` (retry ${1 + retry}` : ''}`)
                commuteDetails = await parseDirectionsAPIResponse(await fetchDirectionsAPIResponse(homeAddress));
                localStorage.setItem(homeAddress, JSON.stringify({...commuteDetails, ...(failed && !updated ? {retries: 1 + retry} : {})}))
            }
            return postProcessCommute(commuteDetails);
        } catch (error) {
            console.error(error)
            return { success: false, error }
        }
    }

    async function rankStekkies() {
        let stekkie = null;
        const locations = [
            { lat: 52.33940589194694, lng:  4.855638496834149, label: 'Uber' }
        ];

        for (let i = 0; stekkie = selectStekkie(i); ++i) {
            const rankingElement = document.createElement('div');
            const commuteDetails = await getCommuteDetails(i);
            // Cyclability note
            let cyclingSummaryHTML = '', commuteLinesSummaryHTML = '';
            if (commuteDetails.cyclable) {
                cyclingSummaryHTML = `<mark style='background-color:#ff00ff45;padding:2px;border-radius:4px;display:block;margin-bottom:0.25em'
            >CYCLABLE in <strong>${commuteDetails.cyclable}</strong></mark>`
            }
            // Public transportation summary
            if (commuteDetails.transit_count > 0) {
                const commuteLinesSummaryHTMLLines = []
                commuteDetails.transit_summary.forEach(([line, duration]) => {
                    commuteLinesSummaryHTMLLines.push(`
                <span style='white-space:nowrap'><strong>${duration}min</strong> on <mark style='background-color:#ff00ff25;padding:2px;border-radius:4px;white-space:nowrap'>
                <img style='display:inline-block;height:1em;position:relative;top:-1px;margin-right:1px' src='${line?.vehicle?.local_icon ?? line?.vehicle?.icon}'>${line?.short_name}
                </mark></span>
                `);
                })
                commuteLinesSummaryHTML = ', ' + commuteLinesSummaryHTMLLines.join(', ');
            }
            rankingElement.innerHTML = `
        ${cyclingSummaryHTML}
        <strong>${commuteDetails.walking_distance}km</strong> walking${commuteLinesSummaryHTML}
        `
            rankingElement.style.padding = '0.5em';
            rankingElement.style.marginBottom = '0.5em';
            rankingElement.style.backgroundColor = 'var(--color-gray-light)';
            selectAddressPriceContainer(i).before(rankingElement);
            selectStekkieViewButton(i).href = getDirectLink(i);
            selectStekkieViewButton(i).target = '_blank';
            selectStekkieViewButton(i).style.filter = 'drop-shadow(1px 1px 0.2rem #00000060)';

            locations.push({...(commuteDetails.start), label: getAddress(i).split(' ')[0]})

            const pricePerM2Value = Math.round(parseInt(getPrice(i)) / parseInt(getAreaM2(i)));
            if (Number.isFinite(pricePerM2Value)) {
                const pricePerM2 = document.createElement('div');
                const red = pricePerM2Value > 25 ? Math.min((pricePerM2Value - 25) / 10, 1) : 0;
                const green = pricePerM2Value < 20 ? Math.min((20 - pricePerM2Value) / 10, 1) : 0;
                pricePerM2.style.cssText = `background-color: rgba(${red > 0 ? '255,0,0' : green > 0 ? '0,255,0' : '255,255,255'}, ${red / 3.0 || green / 3.0});
            padding: 1px`
                pricePerM2.innerHTML = `<strong>${pricePerM2Value} €/m<sup>2</sup></strong>`;
                selectRoomAreaPortalContainer(i).appendChild(pricePerM2);
            }

            if (getTags(i).includes('Students') /*|| getTags(i).includes('Sharing')*/) {
                selectStekkie(i).style.opacity = '0.2';
            } else {
                const tags = getTags(i);
                const score = tags.includes('Garden') + tags.includes('Balcony') + tags.includes('Bath');

                if (score > 0) {
                    selectStekkie(i).style.boxShadow = `0 0 ${score * 4}px ${score * 2}px rgba(0, 180, 0, ${score * 0.15})`;
                }
            }

            //          if (i > 0)
            //              break;
        }

        console.dir(locations)

        // This section was written using AI assistance as I have not been using either Tampermonkey or Openstreetmaps

        document.getElementById('map')?.remove();
        const mapDiv = document.createElement('div');
        mapDiv.id = 'map';
        mapDiv.style.cssText = 'height: 300px; width: 100%; margin-top: 1em;';
        // Fixes the issue where 100% only applies to one column in the 4-col layout starting at lg screen widths
        mapDiv.className = 'lg:col-span-4';
        selectStekkiesContainer().before(mapDiv);

        const map = L.map('map', {
            dragging: false,
            touchZoom: false,
            scrollWheelZoom: false,
        });
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap',
        }).addTo(map);

        const markers = locations.map((loc, i) =>
            L.marker([loc.lat, loc.lng]).bindPopup(loc.label, { autoClose: i !== 0 , closeOnClick: i !== 0  }).addTo(map)
        );

        const bounds = L.latLngBounds(locations.map(loc => [loc.lat, loc.lng]));
        map.fitBounds(bounds, { padding: [20, 20] });

        for (let i = 0; i < locations.length; i++) {
            if (i > 0) {
                const n = i - 1;
                const viewButton = selectStekkieViewButton(n)
                const clickToMap = viewButton.cloneNode(true);
                clickToMap.innerText = 'Show 📌';
                clickToMap.classList.remove('btn-primary')
                clickToMap.classList.add('btn-secondary')
                clickToMap.style.filter = ''
                clickToMap.removeAttribute('href');
                clickToMap.removeAttribute('target');
                clickToMap.addEventListener('click', (e) => {
                    markers[0].closePopup(); // Uber workplace
                    markers[0].openPopup();
                    markers[i].openPopup();
                    mapDiv.scrollIntoView({ behavior: 'smooth' });
                    map.fitBounds([
                        markers[0].getLatLng(),
                        markers[i].getLatLng(),
                    ],
                                  {
                        padding: [30, 30],
                    });
                });
                const clickToSun = viewButton.cloneNode(true);
                clickToSun.classList.remove('btn-primary')
                clickToSun.classList.add('btn-secondary')
                clickToSun.style.filter = ''
                clickToSun.href = `https://shademap.app/@${locations[i].lat},${locations[i].lng},16z,44880000t,0b,0p,0m,q${btoa(getAddress(n))}!${locations[i].lat}!${locations[i].lng}`
                clickToSun.innerText = 'Check 🌞';

                //selectStekkieViewButton(n).before(clickToMap);
                const wrapper = document.createElement('div');
                wrapper.style.display = 'flex';
                wrapper.style.gap = '4px';

                const parent = viewButton.parentNode;
                // wrapper is now in the DOM
                parent.insertBefore(wrapper, viewButton);
                // moves clickToMap into wrapper
                wrapper.appendChild(clickToSun);
                // moves clickToMap into wrapper
                wrapper.appendChild(clickToMap);
                // moves viewButton into wrapper
                wrapper.appendChild(viewButton);
            }
        }
    }

    // PROCEDURAL CODE STARTS HERE

    // PROCEDURAL BEFORE LOADING PAGE

    // prevent the loading of posthog analytics
    new MutationObserver((mutations, observer) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.tagName === 'SCRIPT' && /posthog/i.test(node.src || node.textContent)) {
                    node.remove();
                }
            }
        }
    }).observe(document.documentElement, { childList: true, subtree: true });

    // prevent the injection of the goToMatch functions by the page's framework
    new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType === 1) {
                    node.querySelectorAll?.('[onclick*="goToMatch"]').forEach(el => {
                        el.removeAttribute('onclick');
                    });
                }
            }
        }
    }).observe(document.documentElement, { childList: true, subtree: true });

    console.log('🔐🚨 Disabled page features before loading');

    // PROCEDURAL AFTER LOADING PAGE
    document.addEventListener('DOMContentLoaded', async () => {
        GM_addStyle(GM_getResourceText('leafletCSS'));
        // This fixes an issue where these icons are referenced to the same domain (stekkies.com) which we do not own
        delete L.Icon.Default.prototype._getIconUrl;
        L.Icon.Default.mergeOptions({
            iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
            iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
            shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
        });
        //await rankStekkies();

        // update stekkies after page refreshes and other app events
        let isRanking = false;
        let debounceTimer;

        const observer = new MutationObserver(() => {
            if (isRanking) return;
            clearTimeout(debounceTimer);

            const container = selectStekkiesContainer();
            container.style.opacity = '0.4';
            container.style.pointerEvents = 'none';

            debounceTimer = setTimeout(async () => {
                isRanking = true;
                await rankStekkies();
                isRanking = false;
                container.style.opacity = '1';
                container.style.pointerEvents = 'auto';
            }, 200);
        });

        observer.observe(selectStekkiesContainer(), { childList: true, subtree: true });
    });
})();
