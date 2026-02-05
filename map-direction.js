/**
 * MapDirection - Çoklu Kat Destekli SVG Harita Navigasyonu
 * Portal tabanlı kat geçişleri ile AR yön hesaplama
 */

class MapDirection {
    constructor() {
        // Çoklu kat verileri
        this.floors = new Map(); // floorId -> { rooms, doors, paths, portals, svgElement }
        this.portals = []; // Tüm portallar (portals.json'dan)
        this.floorNames = []; // Yüklenen kat isimleri: ['0', '-1', '-2', '-3']
        
        // Eski tek-kat uyumluluğu için
        this.rooms = [];
        this.doors = [];
        this.paths = [];
        this.svgElement = null;
        this.currentFloor = null;
    }

    // LayerId <-> FloorId dönüşüm tabloları (tüm katlar için)
    static LAYER_TO_FLOOR = { '0': '0', '1': '-1', '2': '-2', '3': '-3', '-1': '-1', '-2': '-2', '-3': '-3' };
    static FLOOR_TO_LAYER = { '0': '0', '-1': '1', '-2': '2', '-3': '3', '1': '1', '2': '2', '3': '3' };

    /**
     * Tüm katları ve portalları yükle
     */
    async loadAllFloors(basePath = './zorlu') {
        console.log('Tüm katlar yükleniyor... Base path:', basePath);
        
        // Mevcut verileri temizle
        this.floors.clear();
        this.floorNames = [];
        this.portals = [];
        
        // 1. Portal verilerini yükle
        await this.loadPortals(`${basePath}/portals.json`);
        
        // 2. Tüm olası kat ID'lerini dene (hem pozitif hem negatif katlar)
        // Zorlu: 0, -1, -2, -3
        // ISG: 0, 1, 2, 3
        const possibleFloorIds = ['0', '1', '2', '3', '-1', '-2', '-3'];
        
        for (const floorId of possibleFloorIds) {
            try {
                const response = await fetch(`${basePath}/${floorId}.svg`);
                if (response.ok) {
                    const content = await response.text();
                    this.loadFloorSVG(floorId, content);
                    this.floorNames.push(floorId);
                    console.log(`Kat ${floorId} yüklendi`);
                }
            } catch (e) {
                // Bu kat mevcut değil, sessizce atla
            }
        }
        
        // Katları sırala (sayısal olarak)
        this.floorNames.sort((a, b) => parseInt(a) - parseInt(b));
        
        console.log(`Toplam ${this.floorNames.length} kat yüklendi:`, this.floorNames);
        
        // 3. Portal koordinatlarını hesapla (Doors bağlantılarından)
        this.calculatePortalCoordinates();
        
        // Varsayılan kat ayarla
        if (this.floorNames.length > 0) {
            this.setCurrentFloor(this.floorNames[0]);
        }
        
        return this.floorNames;
    }

    /**
     * Portal JSON dosyasını yükle
     */
    async loadPortals(path) {
        try {
            const response = await fetch(path);
            if (response.ok) {
                this.portals = await response.json();
                console.log(`${this.portals.length} portal yüklendi`);
            }
        } catch (e) {
            console.log('Portallar yüklenemedi:', e);
            this.portals = [];
        }
    }

    /**
     * Tek bir kat SVG'sini yükle ve parse et
     */
    loadFloorSVG(floorId, svgContent) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(svgContent, 'image/svg+xml');
        const svgElement = doc.documentElement.cloneNode(true);
        
        const floorData = {
            id: floorId,
            svgElement: svgElement,
            rooms: [],
            doors: [],
            paths: [],
            portals: []
        };
        
        this.parseFloorRooms(floorData);
        this.parseFloorDoors(floorData);
        this.parseFloorPaths(floorData);
        
        this.floors.set(floorId, floorData);
        
        console.log(`Kat ${floorId}: ${floorData.rooms.length} oda, ${floorData.doors.length} kapı, ${floorData.paths.length} path`);
    }

    /**
     * Portal koordinatlarını SVG'deki Portals grubundan al
     * Yeni JSON formatı: { id, floorId, Status }
     * Portal ID formatı: Type.Number.TargetFloor (ör: Elev.2.-1)
     */
    calculatePortalCoordinates() {
        console.log('Portal koordinatları hesaplanıyor...');
        
        // Stop çiftlerini topla (aynı kat içi teleport için)
        const stopPairs = new Map(); // key: "floorId-stopNumber", value: { A: portal, B: portal }
        
        this.portals.forEach(portal => {
            // Yeni format: floorId direkt kullanılıyor (eski format: layerId dönüşümü gerekiyordu)
            const floorId = portal.floorId || this.layerIdToFloorId(portal.layerId);
            const floorData = this.floors.get(floorId);
            
            if (!floorData) {
                // Kat yüklenmemiş olabilir (örn: Kat 1)
                return;
            }
            
            // Portal ID'sini parse et
            const portalInfo = this.parsePortalId(portal.id);
            
            let center = null;
            let lineCoords = null; // Stop line'ları için koordinatlar
            let foundElement = null;
            
            // 1. Önce Portals grubunda ara
            const portalsGroup = this.findGroupInSVG(floorData.svgElement, 'Portals');
            if (portalsGroup) {
                const element = portalsGroup.querySelector(`#${CSS.escape(portal.id)}`);
                if (element) {
                    center = this.getLineCenter(element) || this.getElementCenter(element);
                    foundElement = element;
                }
            }
            
            // 2. Portals grubunda bulunamadıysa, tüm SVG'de ara
            if (!center) {
                const element = this.findElementById(floorData.svgElement, portal.id);
                if (element) {
                    center = this.getLineCenter(element) || this.getElementCenter(element);
                    foundElement = element;
                }
            }
            
            // 3. Doors grubunda ara (fallback)
            if (!center) {
                const matchingDoor = floorData.doors.find(d => 
                    d.id === portal.id || 
                    d.id.startsWith(portal.id + '_')
                );
                if (matchingDoor) {
                    center = matchingDoor.center;
                }
            }
            
            // Stop line'ları için tam koordinatları al (path olarak kullanmak için)
            if (foundElement && portalInfo.portalType === 'Stop') {
                const x1 = parseFloat(foundElement.getAttribute('x1'));
                const y1 = parseFloat(foundElement.getAttribute('y1'));
                const x2 = parseFloat(foundElement.getAttribute('x2'));
                const y2 = parseFloat(foundElement.getAttribute('y2'));
                if (!isNaN(x1) && !isNaN(y1) && !isNaN(x2) && !isNaN(y2)) {
                    lineCoords = { x1, y1, x2, y2 };
                }
            }
            
            if (!center) {
                console.log(`Portal ${portal.id} (Kat ${floorId}) için koordinat bulunamadı`);
                return;
            }
            
            // Hedef kat: Portal ID'nin son kısmı (ör: Elev.2.-1 -> hedef kat -1)
            // portalInfo.targetFloor zaten floorId formatında
            const targetFloorId = portalInfo.targetFloor;
            
            const portalData = {
                ...portal,
                ...portalInfo,
                targetFloorId: targetFloorId,
                center: center,
                lineCoords: lineCoords, // Stop'lar için line koordinatları
                floor: floorId
            };
            
            // Stop tipi portal ise çiftleri topla (Status ne olursa olsun koordinat al)
            if (portalInfo.portalType === 'Stop') {
                const stopKey = `${floorId}-${portalInfo.portalNumber}`;
                if (!stopPairs.has(stopKey)) {
                    stopPairs.set(stopKey, { A: null, B: null });
                }
                const pair = stopPairs.get(stopKey);
                if (targetFloorId === 'A') {
                    pair.A = portalData;
                } else if (targetFloorId === 'B') {
                    pair.B = portalData;
                }
            }
            
            // Sadece Status 'On' olan portalleri normal portal listesine ekle (kat geçişleri için)
            if (portal.Status === 'On' && portalInfo.portalType !== 'Stop') {
                floorData.portals.push(portalData);
            }
        });
        
        // Stop çiftlerini floorData.stopTeleports'a kaydet
        stopPairs.forEach((pair, key) => {
            const [floorId, stopNumber] = key.split('-');
            const floorData = this.floors.get(floorId);
            if (!floorData) return;
            
            if (!floorData.stopTeleports) {
                floorData.stopTeleports = [];
            }
            
            if (pair.A && pair.B && pair.A.center && pair.B.center) {
                floorData.stopTeleports.push({
                    stopNumber: stopNumber,
                    A: pair.A,
                    B: pair.B,
                    // A'nın Status'u On ise A->B geçişi aktif
                    aToB: pair.A.Status === 'On',
                    // B'nin Status'u On ise B->A geçişi aktif
                    bToA: pair.B.Status === 'On'
                });
                console.log(`Stop.${stopNumber} çifti bulundu (Kat ${floorId}): A->B=${pair.A.Status === 'On'}, B->A=${pair.B.Status === 'On'}`);
            }
        });
        
        // Portal sayılarını göster
        this.floors.forEach((data, floorId) => {
            console.log(`Kat ${floorId}: ${data.portals.length} portal, ${(data.stopTeleports || []).length} stop teleport çifti`);
            if (data.portals.length > 0) {
                console.log(`  Portallar:`, data.portals.slice(0, 5).map(p => `${p.id} -> Kat ${p.targetFloorId}`));
            }
            if (data.stopTeleports && data.stopTeleports.length > 0) {
                console.log(`  Stop'lar:`, data.stopTeleports.map(s => `Stop.${s.stopNumber} (A->B:${s.aToB}, B->A:${s.bToA})`));
            }
        });
    }

    /**
     * Mevcut katı ayarla
     */
    setCurrentFloor(floorId) {
        const floor = this.floors.get(floorId);
        if (!floor) return false;
        
        this.currentFloor = floorId;
        this.rooms = floor.rooms;
        this.doors = floor.doors;
        this.paths = floor.paths;
        this.svgElement = floor.svgElement;
        
        return true;
    }

    /**
     * Eski tek-SVG yükleme API
     */
    loadSVG(svgContent) {
        this.loadFloorSVG('default', svgContent);
        this.setCurrentFloor('default');
    }

    // ==================== FLOOR PARSING ====================

    parseFloorRooms(floorData) {
        const roomsGroup = this.findGroupInSVG(floorData.svgElement, 'Rooms');
        if (!roomsGroup) return;

        const elements = roomsGroup.querySelectorAll('path, polygon, rect');
        elements.forEach(el => {
            const id = el.getAttribute('id');
            if (!id) return;

            let roomType = 'Unknown';
            let parent = el.parentElement;
            while (parent && parent !== roomsGroup) {
                const parentId = parent.getAttribute('id');
                const parentLabel = parent.getAttribute('inkscape:label');
                if (parentId && !parentId.startsWith('ID') && !parentId.startsWith('g')) {
                    roomType = parentId;
                    break;
                }
                if (parentLabel) {
                    roomType = parentLabel;
                    break;
                }
                parent = parent.parentElement;
            }

            const center = this.getElementCenter(el);
            if (center) {
                floorData.rooms.push({ 
                    id, 
                    type: roomType, 
                    center, 
                    floor: floorData.id,
                    element: el 
                });
            }
        });
    }

    parseFloorDoors(floorData) {
        const doorsGroup = this.findGroupInSVG(floorData.svgElement, 'Doors');
        if (!doorsGroup) return;

        doorsGroup.querySelectorAll('line').forEach(line => {
            const id = line.getAttribute('id');
            if (!id) return;

            const x1 = parseFloat(line.getAttribute('x1')) || 0;
            const y1 = parseFloat(line.getAttribute('y1')) || 0;
            const x2 = parseFloat(line.getAttribute('x2')) || 0;
            const y2 = parseFloat(line.getAttribute('y2')) || 0;

            floorData.doors.push({
                id, x1, y1, x2, y2,
                center: [(x1 + x2) / 2, (y1 + y2) / 2],
                floor: floorData.id
            });
        });

        doorsGroup.querySelectorAll('path').forEach(path => {
            const id = path.getAttribute('id');
            const d = path.getAttribute('d');
            if (!id || !d) return;

            const coords = this.parsePathD(d);
            if (coords && coords.length >= 2) {
                floorData.doors.push({
                    id,
                    x1: coords[0].x, y1: coords[0].y,
                    x2: coords[1].x, y2: coords[1].y,
                    center: [(coords[0].x + coords[1].x) / 2, (coords[0].y + coords[1].y) / 2],
                    floor: floorData.id
                });
            }
        });
    }

    parseFloorPaths(floorData) {
        const pathsGroup = this.findGroupInSVG(floorData.svgElement, 'Paths');
        if (!pathsGroup) return;

        pathsGroup.querySelectorAll('line').forEach(line => {
            const id = line.getAttribute('id');
            if (!id) return;

            const x1 = parseFloat(line.getAttribute('x1')) || 0;
            const y1 = parseFloat(line.getAttribute('y1')) || 0;
            const x2 = parseFloat(line.getAttribute('x2')) || 0;
            const y2 = parseFloat(line.getAttribute('y2')) || 0;

            floorData.paths.push({ id, x1, y1, x2, y2, floor: floorData.id });
        });

        pathsGroup.querySelectorAll('path').forEach(path => {
            const id = path.getAttribute('id');
            const d = path.getAttribute('d');
            if (!id || !d) return;

            const coords = this.parsePathD(d);
            if (coords && coords.length >= 2) {
                for (let i = 0; i < coords.length - 1; i++) {
                    floorData.paths.push({
                        id: `${id}_seg${i}`,
                        x1: coords[i].x,
                        y1: coords[i].y,
                        x2: coords[i + 1].x,
                        y2: coords[i + 1].y,
                        floor: floorData.id
                    });
                }
            }
        });

        pathsGroup.querySelectorAll('polyline').forEach(polyline => {
            const id = polyline.getAttribute('id');
            const points = polyline.getAttribute('points');
            if (!id || !points) return;

            const coords = points.trim().split(/[\s,]+/).map(parseFloat);
            for (let i = 0; i < coords.length - 2; i += 2) {
                if (!isNaN(coords[i]) && !isNaN(coords[i + 1]) && 
                    !isNaN(coords[i + 2]) && !isNaN(coords[i + 3])) {
                    floorData.paths.push({
                        id: `${id}_seg${i / 2}`,
                        x1: coords[i],
                        y1: coords[i + 1],
                        x2: coords[i + 2],
                        y2: coords[i + 3],
                        floor: floorData.id
                    });
                }
            }
        });
    }

    /**
     * Portal ID'sini parse et
     * Örnek: 'Elev.2.-1' -> {portalType: 'Elev', portalNumber: '2', targetFloor: '-1'}
     * Örnek: 'Stairs.10.-2' -> {portalType: 'Stairs', portalNumber: '10', targetFloor: '-2'}
     */
    parsePortalId(portalId) {
        // Format: Type.Number.TargetFloor (targetFloor negatif olabilir: -1, -2, -3)
        const match = portalId.match(/^(Elev|Stairs|Staircase|Stop)\.(\d+)\.(-?\d+|[A-Z])$/);
        if (match) {
            return {
                portalType: match[1],
                portalNumber: match[2],
                targetFloor: match[3] // Floor ID formatında: '0', '-1', '-2', '1' vb.
            };
        }
        return { portalType: 'Unknown', portalNumber: '0', targetFloor: '0' };
    }

    layerIdToFloorId(layerId) {
        return MapDirection.LAYER_TO_FLOOR[layerId] || layerId;
    }

    floorIdToLayerId(floorId) {
        return MapDirection.FLOOR_TO_LAYER[floorId] || '0';
    }

    // ==================== MULTI-FLOOR ROUTING ====================

    /**
     * Çoklu kat rotası hesapla
     */
    calculateMultiFloorRoute(startRoomId, startFloorId, endRoomId, endFloorId) {
        console.log(`\n=== Çoklu Kat Rota Hesaplama ===`);
        console.log(`Başlangıç: ${startRoomId} (Kat ${startFloorId})`);
        console.log(`Hedef: ${endRoomId} (Kat ${endFloorId})`);
        
        // Aynı kattaysak normal rota
        if (startFloorId === endFloorId) {
            console.log('Aynı kat - tek kat rotası');
            this.setCurrentFloor(startFloorId);
            const direction = this.calculateDirection(startRoomId, endRoomId);
            return {
                isSameFloor: true,
                transitions: [],
                segments: [{
                    floor: startFloorId,
                    from: startRoomId,
                    to: endRoomId,
                    direction: direction,
                    type: 'route'
                }]
            };
        }
        
        // Kat geçişlerini planla (hedef oda erişilebilirlik kontrolü ile)
        const transitions = this.planFloorTransitions(startFloorId, endFloorId, startRoomId, endRoomId);
        console.log(`Kat geçiş planı: ${transitions.length} geçiş`);
        
        if (transitions.length === 0) {
            console.error('Kat geçişi planlanamadı!');
            // Fallback: Direkt rota dene
            return this.createFallbackRoute(startRoomId, startFloorId, endRoomId, endFloorId);
        }
        
        // Her geçiş için segment hesapla
        const segments = [];
        let currentStartRoom = startRoomId;
        let currentStartFloor = startFloorId;
        
        for (let i = 0; i < transitions.length; i++) {
            const transition = transitions[i];
            console.log(`\nGeçiş ${i + 1}: Kat ${transition.fromFloor} -> Kat ${transition.toFloor}`);
            console.log(`Portal: ${transition.portal.id} (${transition.portal.portalType} ${transition.portal.portalNumber})`);
            
            // Bu katta: currentStartRoom -> Portal
            this.setCurrentFloor(transition.fromFloor);
            
            let portalDirection = null;
            
            // currentStartRoom bir oda ID'si mi yoksa portal ID'si mi?
            const isRoomId = currentStartRoom.startsWith('ID');
            
            if (isRoomId && transition.portal.center) {
                portalDirection = this.calculateDirectionToPoint(currentStartRoom, transition.portal.center);
            } else if (transition.portal.center) {
                // Önceki portal'dan bu portal'a
                const prevPortal = i > 0 ? transitions[i-1].matchingPortal : null;
                if (prevPortal && prevPortal.center) {
                    portalDirection = this.calculateDirectDirection(prevPortal.center, transition.portal.center);
                }
            }
            
            // Direction bulunamadıysa fallback
            if (!portalDirection && transition.portal.center) {
                const room = this.rooms.find(r => r.id === (isRoomId ? currentStartRoom : startRoomId));
                if (room) {
                    portalDirection = this.calculateDirectDirection(room.center, transition.portal.center);
                }
            }
            
            segments.push({
                floor: transition.fromFloor,
                from: currentStartRoom,
                to: transition.portal.id,
                toPortal: transition.portal,
                direction: portalDirection,
                type: 'route_to_portal'
            });
            
            // Portal geçişi
            const portalTypeName = transition.portal.portalType === 'Elev' ? 'Asansör' : 
                                   transition.portal.portalType === 'Stairs' ? 'Merdiven' : 
                                   transition.portal.portalType;
            
            segments.push({
                floor: transition.fromFloor,
                toFloor: transition.toFloor,
                portal: transition.portal,
                matchingPortal: transition.matchingPortal,
                type: 'portal_transition',
                description: `${portalTypeName} ${transition.portal.portalNumber} ile Kat ${transition.toFloor}'e gidin`
            });
            
            // Sonraki segment için başlangıç
            if (transition.matchingPortal) {
                currentStartRoom = transition.matchingPortal.id;
            }
            currentStartFloor = transition.toFloor;
        }
        
        // Son segment: Son portal -> Hedef oda
        this.setCurrentFloor(endFloorId);
        const lastTransition = transitions[transitions.length - 1];
        const matchingPortal = lastTransition.matchingPortal;
        
        let finalDirection = null;
        
        if (matchingPortal && matchingPortal.center && !matchingPortal.virtual) {
            // Normal portal - koordinattan yön hesapla
            finalDirection = this.calculateDirectionFromPoint(matchingPortal.center, endRoomId);
        } else {
            // Sanal portal veya koordinat yok - hedef odanın merkezine direkt yön
            const endRoom = this.rooms.find(r => r.id === endRoomId);
            if (endRoom) {
                finalDirection = {
                    startPoint: endRoom.center,
                    endPoint: endRoom.center,
                    directionVector: [0, -1],
                    compassAngle: 0,
                    compass: 'Kuzey',
                    confidence: 0.5,
                    note: 'Portal koordinatı bulunamadı'
                };
            }
        }
        
        segments.push({
            floor: endFloorId,
            from: matchingPortal ? matchingPortal.id : 'Kat girişi',
            fromPortal: matchingPortal,
            to: endRoomId,
            direction: finalDirection,
            type: 'route_from_portal'
        });
        
        console.log(`\nToplam ${segments.length} segment oluşturuldu`);
        
        return {
            isSameFloor: false,
            startFloor: startFloorId,
            endFloor: endFloorId,
            transitions: transitions,
            segments: segments
        };
    }

    /**
     * Fallback rota - portal bulunamazsa direkt yön hesapla
     */
    createFallbackRoute(startRoomId, startFloorId, endRoomId, endFloorId) {
        console.log('Fallback rota oluşturuluyor...');
        
        // Başlangıç katında yön hesapla
        this.setCurrentFloor(startFloorId);
        const startRoom = this.rooms.find(r => r.id === startRoomId);
        
        // Hedef katına geçiş bilgisi
        const direction = startRoom ? {
            startPoint: startRoom.center,
            endPoint: startRoom.center,
            directionVector: [0, 1],
            compassAngle: 0,
            compass: 'Kuzey',
            confidence: 0.5
        } : null;
        
        return {
            isSameFloor: false,
            startFloor: startFloorId,
            endFloor: endFloorId,
            transitions: [],
            segments: [
                {
                    floor: startFloorId,
                    from: startRoomId,
                    to: `Kat ${endFloorId}`,
                    direction: direction,
                    type: 'route',
                    note: 'Portal koordinatları bulunamadı - lütfen kat değiştirin'
                },
                {
                    floor: startFloorId,
                    toFloor: endFloorId,
                    type: 'portal_transition',
                    description: `Kat ${endFloorId}'e gidin (asansör veya merdiven kullanın)`
                },
                {
                    floor: endFloorId,
                    from: `Kat ${endFloorId} girişi`,
                    to: endRoomId,
                    direction: null,
                    type: 'route_from_portal',
                    note: 'Hedef katında yönlendirme'
                }
            ]
        };
    }

    /**
     * Kat geçiş planı oluştur
     * @param {string} startFloorId - Başlangıç kat
     * @param {string} endFloorId - Hedef kat
     * @param {string} startRoomId - Başlangıç odası
     * @param {string} endRoomId - Hedef odası (erişilebilirlik kontrolü için)
     */
    planFloorTransitions(startFloorId, endFloorId, startRoomId, endRoomId = null) {
        const startNum = parseInt(startFloorId);
        const endNum = parseInt(endFloorId);
        
        if (startNum === endNum) return [];
        
        const direction = endNum > startNum ? 1 : -1;
        const transitions = [];
        let currentFloorId = startFloorId;
        let currentPoint = this.getRoomCenter(startRoomId, startFloorId);
        
        console.log(`Kat geçişi planlama: ${startFloorId} -> ${endFloorId}, yön: ${direction > 0 ? 'yukarı' : 'aşağı'}`);
        if (endRoomId) {
            console.log(`Hedef oda: ${endRoomId} - erişilebilirlik kontrolü yapılacak`);
        }
        
        let maxIterations = 10; // Sonsuz döngü koruması
        
        while (currentFloorId !== endFloorId && maxIterations-- > 0) {
            const currentNum = parseInt(currentFloorId);
            const floorData = this.floors.get(currentFloorId);
            
            if (!floorData) {
                console.error(`Kat ${currentFloorId} verisi bulunamadı!`);
                break;
            }
            
            console.log(`Mevcut kat ${currentFloorId}: ${floorData.portals.length} portal mevcut`);
            
            if (floorData.portals.length === 0) {
                console.log(`Kat ${currentFloorId}'de portal yok, bir sonraki kata geçiliyor...`);
                // Portal yoksa direkt bir sonraki kata atla
                const nextFloorId = (currentNum + direction).toString();
                currentFloorId = nextFloorId;
                continue;
            }
            
            // Hedef kata direkt giden ve hedef odaya erişilebilir portal var mı?
            let targetPortal = null;
            let matchingPortal = null;
            
            // Hedef kata direkt geçiş yapılacaksa, erişilebilirlik kontrolü yap
            if (endRoomId) {
                const portalPair = this.findAccessiblePortalPair(currentFloorId, endFloorId, endRoomId, currentPoint);
                
                if (portalPair) {
                    targetPortal = portalPair.sourcePortal;
                    matchingPortal = portalPair.targetPortal;
                    console.log(`Erişilebilir direkt portal bulundu: ${targetPortal.id} -> Kat ${endFloorId}`);
                }
            }
            
            // Erişilebilir portal bulunamazsa, normal yöntemi dene
            if (!targetPortal) {
                targetPortal = this.findPortalToFloor(currentFloorId, endFloorId, currentPoint);
                if (targetPortal) {
                    matchingPortal = this.findMatchingPortal(targetPortal, endFloorId);
                }
            }
            
            if (targetPortal) {
                console.log(`Direkt portal bulundu: ${targetPortal.id} -> Kat ${endFloorId}`);
                
                transitions.push({
                    fromFloor: currentFloorId,
                    toFloor: endFloorId,
                    portal: targetPortal,
                    matchingPortal: matchingPortal
                });
                break;
            }
            
            // Direkt portal yok, ara kata git
            const nextFloorId = (currentNum + direction).toString();
            targetPortal = this.findPortalToFloor(currentFloorId, nextFloorId, currentPoint);
            
            if (!targetPortal) {
                // Doğru yöndeki herhangi bir portala git
                targetPortal = this.findAnyPortalInDirection(currentFloorId, direction, currentPoint);
            }
            
            if (targetPortal) {
                const actualTargetFloor = targetPortal.targetFloorId;
                console.log(`Ara portal bulundu: ${targetPortal.id} -> Kat ${actualTargetFloor}`);
                
                const matchingPortal = this.findMatchingPortal(targetPortal, actualTargetFloor);
                
                transitions.push({
                    fromFloor: currentFloorId,
                    toFloor: actualTargetFloor,
                    portal: targetPortal,
                    matchingPortal: matchingPortal
                });
                
                currentFloorId = actualTargetFloor;
                if (matchingPortal && matchingPortal.center) {
                    currentPoint = matchingPortal.center;
                }
            } else {
                console.error(`Kat ${currentFloorId}'den ilerlenecek portal bulunamadı`);
                break;
            }
        }
        
        return transitions;
    }

    /**
     * Belirli bir kata giden portal bul
     */
    findPortalToFloor(fromFloorId, toFloorId, nearPoint) {
        const floorData = this.floors.get(fromFloorId);
        if (!floorData) return null;
        
        // targetFloorId ile eşleştir (floorId formatında)
        const matchingPortals = floorData.portals.filter(p => {
            return p.targetFloorId === toFloorId;
        });
        
        console.log(`  Kat ${fromFloorId}'den Kat ${toFloorId}'e giden portaller: ${matchingPortals.length}`);
        
        if (matchingPortals.length === 0) return null;
        
        if (nearPoint) {
            return this.findNearestPortal(matchingPortals, nearPoint);
        }
        
        return matchingPortals[0];
    }

    /**
     * Belirli bir yönde giden herhangi bir portal bul
     */
    findAnyPortalInDirection(fromFloorId, direction, nearPoint) {
        const floorData = this.floors.get(fromFloorId);
        if (!floorData) return null;
        
        const currentNum = parseInt(fromFloorId);
        
        const matchingPortals = floorData.portals.filter(p => {
            const targetNum = parseInt(p.targetFloorId);
            return direction > 0 ? targetNum > currentNum : targetNum < currentNum;
        });
        
        console.log(`  Kat ${fromFloorId}'den ${direction > 0 ? 'yukarı' : 'aşağı'} giden portaller: ${matchingPortals.length}`);
        
        if (matchingPortals.length === 0) return null;
        
        if (nearPoint) {
            return this.findNearestPortal(matchingPortals, nearPoint);
        }
        
        return matchingPortals[0];
    }

    /**
     * Eşleşen portalı hedef katta bul
     */
    findMatchingPortal(portal, targetFloorId) {
        const targetFloorData = this.floors.get(targetFloorId);
        if (!targetFloorData) {
            console.log(`  Hedef kat ${targetFloorId} verisi bulunamadı`);
            return null;
        }
        
        // Aynı tip ve numara ile eşleş
        const matching = targetFloorData.portals.find(p => {
            return p.portalType === portal.portalType && 
                   p.portalNumber === portal.portalNumber;
        });
        
        if (matching) {
            console.log(`  Eşleşen portal bulundu: ${matching.id} (Kat ${targetFloorId})`);
        } else {
            console.log(`  Eşleşen portal bulunamadı: ${portal.id} (${portal.portalType} ${portal.portalNumber}) Kat ${targetFloorId}'de yok`);
            
            // Hedef katta portal yoksa, sanal bir eşleşme oluştur (koordinatsız)
            // Bu durumda kullanıcı manuel olarak kata geçecek
            return {
                id: `${portal.portalType}.${portal.portalNumber}`,
                portalType: portal.portalType,
                portalNumber: portal.portalNumber,
                center: null, // Koordinat yok
                floor: targetFloorId,
                virtual: true // Sanal portal işareti
            };
        }
        
        return matching;
    }

    /**
     * Noktaya en yakın portalı bul
     */
    findNearestPortal(portals, point) {
        if (!portals || portals.length === 0) return null;
        if (!point) return portals[0];
        
        let nearest = portals[0];
        let minDist = Infinity;
        
        portals.forEach(p => {
            if (p.center) {
                const dist = this.distance(point, p.center);
                if (dist < minDist) {
                    minDist = dist;
                    nearest = p;
                }
            }
        });
        
        return nearest;
    }

    /**
     * Hedef odaya erişilebilir portalları bul (bağlantısız ağlar için)
     * @param {string} roomId - Hedef oda ID
     * @param {string} floorId - Kat ID
     * @returns {Array} Erişilebilir portaller listesi
     */
    findAccessiblePortalsToRoom(roomId, floorId) {
        const floorData = this.floors.get(floorId);
        if (!floorData) {
            console.log(`findAccessiblePortalsToRoom: Kat ${floorId} verisi yok`);
            return [];
        }
        
        // Hedef odanın koordinatlarını al
        const room = floorData.rooms.find(r => r.id === roomId);
        if (!room) {
            console.log(`findAccessiblePortalsToRoom: Oda ${roomId} bulunamadı`);
            return [];
        }
        
        const door = floorData.doors.find(d => d.id === roomId || d.id === roomId.replace('ID', ''));
        const targetPoint = door ? door.center : room.center;
        
        console.log(`findAccessiblePortalsToRoom: Kat ${floorId}'de ${floorData.portals.length} portal kontrol ediliyor...`);
        
        // Kat değişikliği için aktif katı ayarla
        const originalFloor = this.currentFloor;
        this.setCurrentFloor(floorId);
        
        const accessiblePortals = [];
        
        for (const portal of floorData.portals) {
            if (!portal.center) continue;
            
            // Bu portaldan hedef odaya path var mı?
            const pathResult = this.findPathBetweenPoints(portal.center, targetPoint);
            
            if (pathResult && pathResult.length >= 1) {
                console.log(`  ✓ Portal ${portal.id} -> ${roomId}: erişilebilir (${pathResult.length} nokta)`);
                accessiblePortals.push({
                    portal: portal,
                    pathLength: pathResult.length,
                    distance: this.distance(portal.center, targetPoint)
                });
            } else {
                console.log(`  ✗ Portal ${portal.id} -> ${roomId}: erişilemez`);
            }
        }
        
        // Orijinal katı geri yükle
        if (originalFloor) {
            this.setCurrentFloor(originalFloor);
        }
        
        // Mesafeye göre sırala
        accessiblePortals.sort((a, b) => a.distance - b.distance);
        
        console.log(`findAccessiblePortalsToRoom: ${accessiblePortals.length} erişilebilir portal bulundu`);
        return accessiblePortals;
    }

    /**
     * Hedef kata giden ve hedef odaya erişilebilir en yakın portal çiftini bul
     * @param {string} fromFloorId - Başlangıç kat
     * @param {string} toFloorId - Hedef kat
     * @param {string} targetRoomId - Hedef oda
     * @param {Array} nearPoint - Yakınlık noktası
     * @returns {Object|null} {sourcePortal, targetPortal} veya null
     */
    findAccessiblePortalPair(fromFloorId, toFloorId, targetRoomId, nearPoint) {
        console.log(`findAccessiblePortalPair: ${fromFloorId} -> ${toFloorId}, hedef: ${targetRoomId}`);
        
        // Hedef kattaki erişilebilir portalları bul
        const accessiblePortals = this.findAccessiblePortalsToRoom(targetRoomId, toFloorId);
        
        if (accessiblePortals.length === 0) {
            console.log('Hedef odaya erişilebilir portal bulunamadı');
            return null;
        }
        
        // Başlangıç katındaki portalları al
        const fromFloorData = this.floors.get(fromFloorId);
        if (!fromFloorData) return null;
        
        // Her erişilebilir hedef portal için, başlangıç katında eşleşen portal ara
        for (const accessibleEntry of accessiblePortals) {
            const targetPortal = accessibleEntry.portal;
            
            // Başlangıç katında bu portala giden eşleşen portal bul
            const sourcePortal = fromFloorData.portals.find(p => {
                return p.portalType === targetPortal.portalType && 
                       p.portalNumber === targetPortal.portalNumber &&
                       p.targetFloorId === toFloorId;
            });
            
            if (sourcePortal) {
                console.log(`Erişilebilir portal çifti bulundu: ${sourcePortal.id} -> ${targetPortal.id}`);
                return {
                    sourcePortal: sourcePortal,
                    targetPortal: targetPortal,
                    pathLength: accessibleEntry.pathLength,
                    distance: accessibleEntry.distance
                };
            }
        }
        
        console.log('Başlangıç katında eşleşen portal bulunamadı');
        return null;
    }

    /**
     * Odadan noktaya yön hesapla
     */
    calculateDirectionToPoint(roomId, targetPoint) {
        const room = this.rooms.find(r => r.id === roomId);
        if (!room || !targetPoint) return null;
        
        const startDoor = this.findDoorForRoom(roomId);
        const startPoint = startDoor ? startDoor.center : room.center;
        
        const pathResult = this.findPathBetweenPoints(startPoint, targetPoint);
        
        if (pathResult && pathResult.length >= 2) {
            const pathWithDoor = [startPoint, ...pathResult];
            return this.calculateDirectionFromPath(pathWithDoor, 5);
        }
        
        return this.calculateDirectDirection(startPoint, targetPoint);
    }

    /**
     * Noktadan odaya yön hesapla
     */
    calculateDirectionFromPoint(startPoint, roomId) {
        const room = this.rooms.find(r => r.id === roomId);
        if (!room || !startPoint) return null;
        
        const endDoor = this.findDoorForRoom(roomId);
        const endPoint = endDoor ? endDoor.center : room.center;
        
        const pathResult = this.findPathBetweenPoints(startPoint, endPoint);
        
        if (pathResult && pathResult.length >= 2) {
            return this.calculateDirectionFromPath(pathResult, 5);
        }
        
        return this.calculateDirectDirection(startPoint, endPoint);
    }

    /**
     * Oda merkezi al
     */
    getRoomCenter(roomId, floorId) {
        const floorData = this.floors.get(floorId);
        if (!floorData) return null;
        
        const room = floorData.rooms.find(r => r.id === roomId);
        return room ? room.center : null;
    }

    // ==================== HELPER FUNCTIONS ====================

    findGroupInSVG(svgElement, name) {
        let group = svgElement.querySelector(`g#${name}`);
        if (group) return group;

        const allGroups = svgElement.querySelectorAll('g');
        for (const g of allGroups) {
            if (g.getAttribute('inkscape:label') === name) return g;
        }
        return null;
    }

    findElementById(svgElement, id) {
        try {
            return svgElement.querySelector(`#${CSS.escape(id)}`);
        } catch (e) {
            return null;
        }
    }

    getElementCenter(el) {
        if (!el) return null;
        const tag = el.tagName.toLowerCase();

        if (tag === 'rect') {
            const x = parseFloat(el.getAttribute('x')) || 0;
            const y = parseFloat(el.getAttribute('y')) || 0;
            const w = parseFloat(el.getAttribute('width')) || 0;
            const h = parseFloat(el.getAttribute('height')) || 0;
            return [x + w / 2, y + h / 2];
        }

        if (tag === 'polygon') {
            const points = el.getAttribute('points');
            if (!points) return null;
            const coords = points.trim().split(/[\s,]+/).map(parseFloat);
            let sx = 0, sy = 0, count = 0;
            for (let i = 0; i < coords.length; i += 2) {
                if (!isNaN(coords[i]) && !isNaN(coords[i + 1])) {
                    sx += coords[i];
                    sy += coords[i + 1];
                    count++;
                }
            }
            return count > 0 ? [sx / count, sy / count] : null;
        }

        if (tag === 'path') {
            const d = el.getAttribute('d');
            if (!d) return null;
            const coords = this.parsePathD(d);
            if (!coords || coords.length === 0) return null;
            let sx = 0, sy = 0;
            coords.forEach(c => { sx += c.x; sy += c.y; });
            return [sx / coords.length, sy / coords.length];
        }

        if (tag === 'line') {
            return this.getLineCenter(el);
        }

        return null;
    }

    getLineCenter(el) {
        if (!el) return null;
        const x1 = parseFloat(el.getAttribute('x1')) || 0;
        const y1 = parseFloat(el.getAttribute('y1')) || 0;
        const x2 = parseFloat(el.getAttribute('x2')) || 0;
        const y2 = parseFloat(el.getAttribute('y2')) || 0;
        return [(x1 + x2) / 2, (y1 + y2) / 2];
    }

    parsePathD(d) {
        const coords = [];
        const regex = /([MLHVZ])\s*([^MLHVZ]*)/gi;
        let match, cx = 0, cy = 0;

        while ((match = regex.exec(d)) !== null) {
            const cmd = match[1].toUpperCase();
            const params = match[2].trim().split(/[\s,]+/).map(parseFloat).filter(n => !isNaN(n));

            switch (cmd) {
                case 'M':
                case 'L':
                    for (let i = 0; i < params.length; i += 2) {
                        cx = params[i];
                        cy = params[i + 1];
                        coords.push({ x: cx, y: cy });
                    }
                    break;
                case 'H':
                    params.forEach(x => { cx = x; coords.push({ x: cx, y: cy }); });
                    break;
                case 'V':
                    params.forEach(y => { cy = y; coords.push({ x: cx, y: cy }); });
                    break;
            }
        }
        return coords;
    }

    // ==================== EXISTING API ====================

    getRooms() {
        return this.rooms;
    }

    getRoomsForFloor(floorId) {
        const floorData = this.floors.get(floorId);
        return floorData ? floorData.rooms : [];
    }

    getAllRooms() {
        const allRooms = [];
        this.floors.forEach((floorData, floorId) => {
            floorData.rooms.forEach(room => {
                allRooms.push({ ...room, floor: floorId });
            });
        });
        return allRooms;
    }

    findDoorForRoom(roomId) {
        let door = this.doors.find(d => d.id.startsWith(roomId + '_'));
        
        if (!door) {
            const room = this.rooms.find(r => r.id === roomId);
            if (!room) return null;

            let minDist = Infinity;
            this.doors.forEach(d => {
                const dist = this.distance(room.center, d.center);
                if (dist < minDist) {
                    minDist = dist;
                    door = d;
                }
            });
        }

        return door;
    }

    calculateDirection(startRoomId, endRoomId) {
        const startRoom = this.rooms.find(r => r.id === startRoomId);
        const endRoom = this.rooms.find(r => r.id === endRoomId);

        if (!startRoom || !endRoom) {
            console.error('Oda bulunamadı');
            return null;
        }

        const startDoor = this.findDoorForRoom(startRoomId);
        const endDoor = this.findDoorForRoom(endRoomId);

        const startPoint = startDoor ? startDoor.center : startRoom.center;
        const endPoint = endDoor ? endDoor.center : endRoom.center;

        const pathResult = this.findPathBetweenPoints(startPoint, endPoint);
        
        if (pathResult && pathResult.length >= 2) {
            const pathWithDoor = [startPoint, ...pathResult];
            return this.calculateDirectionFromPath(pathWithDoor, 5);
        }

        return this.calculateDirectDirection(startPoint, endPoint);
    }

    calculateDirectDirection(startPoint, endPoint) {
        const dx = endPoint[0] - startPoint[0];
        const dy = endPoint[1] - startPoint[1];
        const length = Math.sqrt(dx * dx + dy * dy);

        if (length === 0) return null;

        const normDx = dx / length;
        const normDy = dy / length;

        const angleRad = Math.atan2(normDy, normDx);
        const angleDeg = angleRad * (180 / Math.PI);
        const compassAngle = ((90 - angleDeg) % 360 + 360) % 360;
        const compass = this.getCompassDirection(compassAngle);
        const confidence = Math.min(1.0, length / 500);

        return {
            startPoint,
            endPoint,
            directionVector: [normDx, normDy],
            angleDegrees: angleDeg,
            compassAngle,
            compass,
            confidence,
            distance: length
        };
    }

    calculateDirectionFromPath(pathPoints, maxSegments = 5) {
        if (pathPoints.length < 2) return null;

        let weightedDx = 0;
        let weightedDy = 0;
        let totalWeight = 0;
        let segmentsUsed = 0;

        for (let i = 0; i < Math.min(maxSegments, pathPoints.length - 1); i++) {
            const p1 = pathPoints[i];
            const p2 = pathPoints[i + 1];

            const dx = p2[0] - p1[0];
            const dy = p2[1] - p1[1];
            const length = Math.sqrt(dx * dx + dy * dy);

            if (length < 1) continue;

            const weight = length;

            weightedDx += (dx / length) * weight;
            weightedDy += (dy / length) * weight;
            totalWeight += weight;
            segmentsUsed++;
        }

        if (totalWeight === 0) return null;

        let avgDx = weightedDx / totalWeight;
        let avgDy = weightedDy / totalWeight;
        const magnitude = Math.sqrt(avgDx * avgDx + avgDy * avgDy);

        if (magnitude > 0) {
            avgDx /= magnitude;
            avgDy /= magnitude;
        }

        const angleRad = Math.atan2(avgDy, avgDx);
        const angleDeg = angleRad * (180 / Math.PI);
        const compassAngle = ((90 - angleDeg) % 360 + 360) % 360;
        const compass = this.getCompassDirection(compassAngle);
        const confidence = Math.min(1.0, magnitude * segmentsUsed / maxSegments);

        return {
            startPoint: pathPoints[0],
            endPoint: pathPoints[pathPoints.length - 1],
            directionVector: [avgDx, avgDy],
            angleDegrees: angleDeg,
            compassAngle,
            compass,
            confidence,
            segmentsUsed
        };
    }

    findPathBetweenPoints(startPoint, endPoint) {
        if (this.paths.length === 0) return null;

        const graph = new Map();
        const idToCoord = new Map();
        const nodes = [];
        let nodeId = 0;
        
        const TOLERANCE = 1.0;
        
        const getNodeId = (x, y) => {
            for (let i = 0; i < nodes.length; i++) {
                const node = nodes[i];
                const dist = Math.sqrt(Math.pow(node.x - x, 2) + Math.pow(node.y - y, 2));
                if (dist <= TOLERANCE) {
                    return node.id;
                }
            }
            
            const id = nodeId++;
            nodes.push({ id, x, y });
            idToCoord.set(id, [x, y]);
            graph.set(id, []);
            return id;
        };

        this.paths.forEach(path => {
            const id1 = getNodeId(path.x1, path.y1);
            const id2 = getNodeId(path.x2, path.y2);
            
            if (id1 === id2) return;
            
            const dist = Math.sqrt(Math.pow(path.x2 - path.x1, 2) + Math.pow(path.y2 - path.y1, 2));

            const existing1 = graph.get(id1).find(e => e.node === id2);
            if (!existing1) {
                graph.get(id1).push({ node: id2, dist });
            }
            
            const existing2 = graph.get(id2).find(e => e.node === id1);
            if (!existing2) {
                graph.get(id2).push({ node: id1, dist });
            }
        });
        
        // Stop teleport'ları sanal edge olarak ekle (aynı kat içi ışınlanma)
        // Not: Stop line'ları Portals grubunda, Paths grubunda değil - bu yüzden hem path hem teleport olarak ekliyoruz
        const currentFloorData = this.floors.get(this.currentFloor);
        
        // Path düğümlerinin sayısını kaydet (Stop'ları eklemeden önce)
        const pathNodeCountBeforeStops = nodes.length;
        
        // En yakın path düğümünü bulma fonksiyonu (mesafe sınırı yok - en yakını bul)
        const findNearestPathNode = (x, y) => {
            let nearestId = null;
            let nearestDist = Infinity;
            
            // Sadece path düğümlerinde ara (Stop düğümlerinde değil)
            for (let i = 0; i < pathNodeCountBeforeStops; i++) {
                const node = nodes[i];
                const dist = Math.sqrt(Math.pow(node.x - x, 2) + Math.pow(node.y - y, 2));
                if (dist < nearestDist) {
                    nearestDist = dist;
                    nearestId = node.id;
                }
            }
            return { nodeId: nearestId, dist: nearestDist };
        };
        
        if (currentFloorData && currentFloorData.stopTeleports) {
            currentFloorData.stopTeleports.forEach(stop => {
                // Stop A line'ının koordinatları (SVG'den)
                const aLine = stop.A;
                const bLine = stop.B;
                
                // Stop line'larını graph'a path segmenti olarak ekle
                let aLineNodes = [];
                let bLineNodes = [];
                
                if (aLine.lineCoords) {
                    const aId1 = getNodeId(aLine.lineCoords.x1, aLine.lineCoords.y1);
                    const aId2 = getNodeId(aLine.lineCoords.x2, aLine.lineCoords.y2);
                    aLineNodes = [aId1, aId2];
                    if (aId1 !== aId2) {
                        const dist = Math.sqrt(Math.pow(aLine.lineCoords.x2 - aLine.lineCoords.x1, 2) + 
                                              Math.pow(aLine.lineCoords.y2 - aLine.lineCoords.y1, 2));
                        if (!graph.get(aId1).find(e => e.node === aId2)) {
                            graph.get(aId1).push({ node: aId2, dist });
                        }
                        if (!graph.get(aId2).find(e => e.node === aId1)) {
                            graph.get(aId2).push({ node: aId1, dist });
                        }
                    }
                    
                    // Stop A line uç noktalarını en yakın path düğümüne bağla
                    const nearest1 = findNearestPathNode(aLine.lineCoords.x1, aLine.lineCoords.y1);
                    const nearest2 = findNearestPathNode(aLine.lineCoords.x2, aLine.lineCoords.y2);
                    
                    if (nearest1.nodeId !== null && nearest1.nodeId !== aId1) {
                        if (!graph.get(aId1).find(e => e.node === nearest1.nodeId)) {
                            graph.get(aId1).push({ node: nearest1.nodeId, dist: nearest1.dist });
                            graph.get(nearest1.nodeId).push({ node: aId1, dist: nearest1.dist });
                            console.log(`Stop.${stop.stopNumber}.A uç1 -> path node ${nearest1.nodeId} bağlandı (mesafe: ${nearest1.dist.toFixed(1)})`);
                        }
                    }
                    if (nearest2.nodeId !== null && nearest2.nodeId !== aId2) {
                        if (!graph.get(aId2).find(e => e.node === nearest2.nodeId)) {
                            graph.get(aId2).push({ node: nearest2.nodeId, dist: nearest2.dist });
                            graph.get(nearest2.nodeId).push({ node: aId2, dist: nearest2.dist });
                            console.log(`Stop.${stop.stopNumber}.A uç2 -> path node ${nearest2.nodeId} bağlandı (mesafe: ${nearest2.dist.toFixed(1)})`);
                        }
                    }
                }
                
                if (bLine.lineCoords) {
                    const bId1 = getNodeId(bLine.lineCoords.x1, bLine.lineCoords.y1);
                    const bId2 = getNodeId(bLine.lineCoords.x2, bLine.lineCoords.y2);
                    bLineNodes = [bId1, bId2];
                    if (bId1 !== bId2) {
                        const dist = Math.sqrt(Math.pow(bLine.lineCoords.x2 - bLine.lineCoords.x1, 2) + 
                                              Math.pow(bLine.lineCoords.y2 - bLine.lineCoords.y1, 2));
                        if (!graph.get(bId1).find(e => e.node === bId2)) {
                            graph.get(bId1).push({ node: bId2, dist });
                        }
                        if (!graph.get(bId2).find(e => e.node === bId1)) {
                            graph.get(bId2).push({ node: bId1, dist });
                        }
                    }
                    
                    // Stop B line uç noktalarını en yakın path düğümüne bağla
                    const nearest1 = findNearestPathNode(bLine.lineCoords.x1, bLine.lineCoords.y1);
                    const nearest2 = findNearestPathNode(bLine.lineCoords.x2, bLine.lineCoords.y2);
                    
                    if (nearest1.nodeId !== null && nearest1.nodeId !== bId1) {
                        if (!graph.get(bId1).find(e => e.node === nearest1.nodeId)) {
                            graph.get(bId1).push({ node: nearest1.nodeId, dist: nearest1.dist });
                            graph.get(nearest1.nodeId).push({ node: bId1, dist: nearest1.dist });
                            console.log(`Stop.${stop.stopNumber}.B uç1 -> path node ${nearest1.nodeId} bağlandı (mesafe: ${nearest1.dist.toFixed(1)})`);
                        }
                    }
                    if (nearest2.nodeId !== null && nearest2.nodeId !== bId2) {
                        if (!graph.get(bId2).find(e => e.node === nearest2.nodeId)) {
                            graph.get(bId2).push({ node: nearest2.nodeId, dist: nearest2.dist });
                            graph.get(nearest2.nodeId).push({ node: bId2, dist: nearest2.dist });
                            console.log(`Stop.${stop.stopNumber}.B uç2 -> path node ${nearest2.nodeId} bağlandı (mesafe: ${nearest2.dist.toFixed(1)})`);
                        }
                    }
                }
                
                // Stop merkez noktalarını al
                const aCenter = aLine.center;
                const bCenter = bLine.center;
                
                // Stop merkez noktalarını graph'a ekle
                const aNodeId = getNodeId(aCenter[0], aCenter[1]);
                const bNodeId = getNodeId(bCenter[0], bCenter[1]);
                
                // *** ÖNEMLİ: Stop merkezlerini doğrudan en yakın path düğümüne bağla ***
                const nearestToA = findNearestPathNode(aCenter[0], aCenter[1]);
                const nearestToB = findNearestPathNode(bCenter[0], bCenter[1]);
                
                if (nearestToA.nodeId !== null && nearestToA.nodeId !== aNodeId) {
                    graph.get(aNodeId).push({ node: nearestToA.nodeId, dist: nearestToA.dist });
                    graph.get(nearestToA.nodeId).push({ node: aNodeId, dist: nearestToA.dist });
                    console.log(`Stop.${stop.stopNumber}.A merkez -> path node ${nearestToA.nodeId} bağlandı (mesafe: ${nearestToA.dist.toFixed(1)})`);
                }
                
                if (nearestToB.nodeId !== null && nearestToB.nodeId !== bNodeId) {
                    graph.get(bNodeId).push({ node: nearestToB.nodeId, dist: nearestToB.dist });
                    graph.get(nearestToB.nodeId).push({ node: bNodeId, dist: nearestToB.dist });
                    console.log(`Stop.${stop.stopNumber}.B merkez -> path node ${nearestToB.nodeId} bağlandı (mesafe: ${nearestToB.dist.toFixed(1)})`);
                }
                
                // Teleport mesafesi çok küçük (ışınlanma)
                const teleportDist = 0.1;
                
                // A->B geçişi aktif mi?
                if (stop.aToB) {
                    const existing = graph.get(aNodeId).find(e => e.node === bNodeId);
                    if (!existing) {
                        graph.get(aNodeId).push({ node: bNodeId, dist: teleportDist, isTeleport: true });
                        console.log(`Stop.${stop.stopNumber}: A->B teleport eklendi`);
                    }
                }
                
                // B->A geçişi aktif mi?
                if (stop.bToA) {
                    const existing = graph.get(bNodeId).find(e => e.node === aNodeId);
                    if (!existing) {
                        graph.get(bNodeId).push({ node: aNodeId, dist: teleportDist, isTeleport: true });
                        console.log(`Stop.${stop.stopNumber}: B->A teleport eklendi`);
                    }
                }
            });
        }

        let startNodeId = null, endNodeId = null;
        let minStartDist = Infinity, minEndDist = Infinity;

        for (const node of nodes) {
            const coord = [node.x, node.y];
            const startDist = this.distance(startPoint, coord);
            if (startDist < minStartDist) {
                minStartDist = startDist;
                startNodeId = node.id;
            }

            const endDist = this.distance(endPoint, coord);
            if (endDist < minEndDist) {
                minEndDist = endDist;
                endNodeId = node.id;
            }
        }
        
        console.log(`findPathBetweenPoints: ${nodes.length} node, startDist=${minStartDist.toFixed(1)}, endDist=${minEndDist.toFixed(1)}`);
        console.log(`  startNode=${startNodeId}, endNode=${endNodeId}`);
        console.log(`  Başlangıç koordinatı:`, idToCoord.get(startNodeId));
        console.log(`  Hedef koordinatı:`, idToCoord.get(endNodeId));
        
        // Graf bağlantılılığını kontrol et (BFS ile)
        const visited = new Set();
        const queue = [startNodeId];
        visited.add(startNodeId);
        while (queue.length > 0) {
            const current = queue.shift();
            for (const edge of graph.get(current) || []) {
                if (!visited.has(edge.node)) {
                    visited.add(edge.node);
                    queue.push(edge.node);
                }
            }
        }
        const isEndReachable = visited.has(endNodeId);
        console.log(`  BFS: ${visited.size}/${nodes.length} düğüme ulaşılabilir. Hedef ulaşılabilir: ${isEndReachable}`);
        
        // Ulaşılabilir düğümlerin sınır koordinatlarını bul
        if (!isEndReachable && visited.size > 0) {
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            const reachableCoords = [];
            visited.forEach(nodeId => {
                const coord = idToCoord.get(nodeId);
                if (coord) {
                    reachableCoords.push(coord);
                    minX = Math.min(minX, coord[0]);
                    maxX = Math.max(maxX, coord[0]);
                    minY = Math.min(minY, coord[1]);
                    maxY = Math.max(maxY, coord[1]);
                }
            });
            console.log(`  Ulaşılabilir alan: X[${minX.toFixed(0)}-${maxX.toFixed(0)}], Y[${minY.toFixed(0)}-${maxY.toFixed(0)}]`);
            
            // Hedefin koordinatı
            const endCoord = idToCoord.get(endNodeId);
            if (endCoord) {
                console.log(`  Hedef (${endCoord[0].toFixed(0)}, ${endCoord[1].toFixed(0)}) ulaşılabilir alanın dışında!`);
            }
            
            // Sınır düğümlerini bul (ulaşılabilir ama hedefe en yakın olanlar)
            let closestToEnd = null;
            let closestDist = Infinity;
            visited.forEach(nodeId => {
                const coord = idToCoord.get(nodeId);
                if (coord && endCoord) {
                    const dist = Math.sqrt(Math.pow(coord[0] - endCoord[0], 2) + Math.pow(coord[1] - endCoord[1], 2));
                    if (dist < closestDist) {
                        closestDist = dist;
                        closestToEnd = { nodeId, coord };
                    }
                }
            });
            if (closestToEnd) {
                console.log(`  Hedefe en yakın ulaşılabilir düğüm: node ${closestToEnd.nodeId} at (${closestToEnd.coord[0].toFixed(1)}, ${closestToEnd.coord[1].toFixed(1)}), mesafe: ${closestDist.toFixed(1)}`);
            }
        }

        if (startNodeId === null || endNodeId === null) {
            console.warn('Path node bulunamadı');
            return null;
        }
        if (startNodeId === endNodeId) return [idToCoord.get(startNodeId)];

        // Dijkstra
        const distances = new Map();
        const previous = new Map();
        const unvisited = new Set();

        for (const [id] of graph) {
            distances.set(id, Infinity);
            unvisited.add(id);
        }
        distances.set(startNodeId, 0);

        while (unvisited.size > 0) {
            let current = null;
            let minDist = Infinity;

            for (const id of unvisited) {
                if (distances.get(id) < minDist) {
                    minDist = distances.get(id);
                    current = id;
                }
            }

            if (current === null || current === endNodeId) break;
            unvisited.delete(current);

            for (const neighbor of graph.get(current)) {
                const alt = distances.get(current) + neighbor.dist;
                if (alt < distances.get(neighbor.node)) {
                    distances.set(neighbor.node, alt);
                    previous.set(neighbor.node, current);
                }
            }
        }

        const pathNodeIds = [];
        let current = endNodeId;

        while (current !== undefined && current !== null) {
            pathNodeIds.unshift(current);
            current = previous.get(current);
        }
        
        // Dijkstra başarısız oldu mu kontrol et
        if (pathNodeIds.length === 0 || pathNodeIds[0] !== startNodeId) {
            console.warn(`Dijkstra: Yol bulunamadı! pathNodeIds=${pathNodeIds.length}, ilk=${pathNodeIds[0]}, startNode=${startNodeId}`);
            console.log(`Hedef mesafe: ${distances.get(endNodeId)}`);
            return null;
        }

        const pathCoords = pathNodeIds.map(id => idToCoord.get(id));
        return pathCoords.length > 1 ? pathCoords : null;
    }

    getCompassDirection(angle) {
        angle = ((angle % 360) + 360) % 360;
        
        if (angle < 22.5 || angle >= 337.5) return 'Kuzey';
        if (angle < 67.5) return 'Kuzeydoğu';
        if (angle < 112.5) return 'Doğu';
        if (angle < 157.5) return 'Güneydoğu';
        if (angle < 202.5) return 'Güney';
        if (angle < 247.5) return 'Güneybatı';
        if (angle < 292.5) return 'Batı';
        return 'Kuzeybatı';
    }

    distance(p1, p2) {
        return Math.sqrt(Math.pow(p2[0] - p1[0], 2) + Math.pow(p2[1] - p1[1], 2));
    }

    drawArrowOnSVG(direction) {
        if (!this.svgElement || !direction) return;

        const oldArrow = this.svgElement.querySelector('#direction-arrow-group');
        if (oldArrow) oldArrow.remove();

        const ns = 'http://www.w3.org/2000/svg';
        const group = document.createElementNS(ns, 'g');
        group.setAttribute('id', 'direction-arrow-group');

        const startX = direction.startPoint[0];
        const startY = direction.startPoint[1];
        const arrowLength = 80;
        const endX = startX + direction.directionVector[0] * arrowLength;
        const endY = startY + direction.directionVector[1] * arrowLength;

        const line = document.createElementNS(ns, 'line');
        line.setAttribute('x1', startX);
        line.setAttribute('y1', startY);
        line.setAttribute('x2', endX);
        line.setAttribute('y2', endY);
        line.setAttribute('stroke', '#00ff00');
        line.setAttribute('stroke-width', '4');
        line.setAttribute('stroke-linecap', 'round');
        group.appendChild(line);

        const angle = Math.atan2(direction.directionVector[1], direction.directionVector[0]);
        const headLen = 15;
        const headAngle = Math.PI / 6;

        const head = document.createElementNS(ns, 'polygon');
        const hx1 = endX - headLen * Math.cos(angle - headAngle);
        const hy1 = endY - headLen * Math.sin(angle - headAngle);
        const hx2 = endX - headLen * Math.cos(angle + headAngle);
        const hy2 = endY - headLen * Math.sin(angle + headAngle);
        head.setAttribute('points', `${endX},${endY} ${hx1},${hy1} ${hx2},${hy2}`);
        head.setAttribute('fill', '#00ff00');
        group.appendChild(head);

        const circle = document.createElementNS(ns, 'circle');
        circle.setAttribute('cx', startX);
        circle.setAttribute('cy', startY);
        circle.setAttribute('r', '8');
        circle.setAttribute('fill', '#00ff00');
        circle.setAttribute('stroke', '#fff');
        circle.setAttribute('stroke-width', '2');
        group.appendChild(circle);

        this.svgElement.appendChild(group);
    }

    // ==================== DEBUG & TEST FUNCTIONS ====================

    /**
     * Stop noktasının koordinatlarını al
     * @param {string} stopId - Örnek: "Stop.7.A" veya "Stop.7.B"
     * @param {string} floorId - Kat ID
     * @returns {object|null} - { center: [x, y], lineCoords: { x1, y1, x2, y2 } }
     */
    getStopCoordinates(stopId, floorId) {
        const floorData = this.floors.get(floorId);
        if (!floorData || !floorData.stopTeleports) {
            console.warn(`Kat ${floorId} bulunamadı veya Stop yok`);
            return null;
        }
        
        // Stop ID'yi parse et (Stop.7.A -> stopNumber=7, side=A)
        const match = stopId.match(/^Stop\.(\d+)\.([AB])$/i);
        if (!match) {
            console.warn(`Geçersiz Stop ID: ${stopId}`);
            return null;
        }
        
        const stopNumber = match[1];
        const side = match[2].toUpperCase();
        
        const stopPair = floorData.stopTeleports.find(s => s.stopNumber === stopNumber);
        if (!stopPair) {
            console.warn(`Stop.${stopNumber} bulunamadı (Kat ${floorId})`);
            return null;
        }
        
        const stopData = side === 'A' ? stopPair.A : stopPair.B;
        if (!stopData) {
            console.warn(`Stop.${stopNumber}.${side} bulunamadı`);
            return null;
        }
        
        return {
            id: stopId,
            center: stopData.center,
            lineCoords: stopData.lineCoords,
            status: stopData.Status
        };
    }

    /**
     * Bir odadan Stop noktasına rota hesapla (TEST için)
     * @param {string} roomId - Başlangıç odası ID
     * @param {string} stopId - Hedef Stop ID (örn: "Stop.7.A")
     * @param {string} floorId - Kat ID
     */
    testRouteToStop(roomId, stopId, floorId) {
        console.log(`\n=== TEST: ${roomId} -> ${stopId} (Kat ${floorId}) ===`);
        
        this.setCurrentFloor(floorId);
        
        // Oda koordinatını bul
        const room = this.rooms.find(r => r.id === roomId);
        if (!room) {
            console.error(`Oda bulunamadı: ${roomId}`);
            return null;
        }
        
        // Stop koordinatını bul
        const stopCoords = this.getStopCoordinates(stopId, floorId);
        if (!stopCoords) {
            return null;
        }
        
        console.log(`Oda ${roomId} merkezi:`, room.center);
        console.log(`${stopId} merkezi:`, stopCoords.center);
        console.log(`${stopId} line koordinatları:`, stopCoords.lineCoords);
        
        // Path hesapla
        const path = this.findPathBetweenPoints(room.center, stopCoords.center);
        
        if (path) {
            console.log(`✅ Rota bulundu! ${path.length} nokta`);
            console.log(`Rota:`, path);
            return path;
        } else {
            console.error(`❌ Rota bulunamadı: ${roomId} -> ${stopId}`);
            return null;
        }
    }

    /**
     * Stop noktasından bir odaya rota hesapla (TEST için)
     * @param {string} stopId - Başlangıç Stop ID (örn: "Stop.7.B")
     * @param {string} roomId - Hedef odası ID
     * @param {string} floorId - Kat ID
     */
    testRouteFromStop(stopId, roomId, floorId) {
        console.log(`\n=== TEST: ${stopId} -> ${roomId} (Kat ${floorId}) ===`);
        
        this.setCurrentFloor(floorId);
        
        // Stop koordinatını bul
        const stopCoords = this.getStopCoordinates(stopId, floorId);
        if (!stopCoords) {
            return null;
        }
        
        // Oda koordinatını bul
        const room = this.rooms.find(r => r.id === roomId);
        if (!room) {
            console.error(`Oda bulunamadı: ${roomId}`);
            return null;
        }
        
        console.log(`${stopId} merkezi:`, stopCoords.center);
        console.log(`${stopId} line koordinatları:`, stopCoords.lineCoords);
        console.log(`Oda ${roomId} merkezi:`, room.center);
        
        // Path hesapla
        const path = this.findPathBetweenPoints(stopCoords.center, room.center);
        
        if (path) {
            console.log(`✅ Rota bulundu! ${path.length} nokta`);
            console.log(`Rota:`, path);
            return path;
        } else {
            console.error(`❌ Rota bulunamadı: ${stopId} -> ${roomId}`);
            return null;
        }
    }

    /**
     * Tam Stop teleport testini çalıştır
     * ID235 -> Stop.7.A -> [TELEPORT] -> Stop.7.B -> ID220A
     */
    testFullStopRoute(startRoomId, stopNumber, endRoomId, floorId) {
        console.log(`\n========================================`);
        console.log(`FULL STOP TEST: ${startRoomId} -> Stop.${stopNumber} -> ${endRoomId}`);
        console.log(`========================================\n`);
        
        // 1. startRoom -> Stop.X.A
        const path1 = this.testRouteToStop(startRoomId, `Stop.${stopNumber}.A`, floorId);
        
        // 2. Stop.X.B -> endRoom
        const path2 = this.testRouteFromStop(`Stop.${stopNumber}.B`, endRoomId, floorId);
        
        if (path1 && path2) {
            console.log(`\n✅✅ TAM ROTA BAŞARILI ✅✅`);
            console.log(`${startRoomId} -> Stop.${stopNumber}.A: ${path1.length} nokta`);
            console.log(`Stop.${stopNumber}.B -> ${endRoomId}: ${path2.length} nokta`);
            return { path1, path2 };
        } else {
            console.error(`\n❌❌ TAM ROTA BAŞARISIZ ❌❌`);
            return null;
        }
    }

    /**
     * Graf yapısını analiz et - bağlantısız bileşenleri bul
     */
    analyzeGraph(floorId) {
        console.log(`\n=== Graf Analizi (Kat ${floorId}) ===`);
        
        this.setCurrentFloor(floorId);
        
        if (this.paths.length === 0) {
            console.error('Path yok!');
            return;
        }
        
        // Graf oluştur
        const graph = new Map();
        const idToCoord = new Map();
        const nodes = [];
        let nodeId = 0;
        const TOLERANCE = 1.0;
        
        const getNodeId = (x, y) => {
            for (let i = 0; i < nodes.length; i++) {
                const node = nodes[i];
                const dist = Math.sqrt(Math.pow(node.x - x, 2) + Math.pow(node.y - y, 2));
                if (dist <= TOLERANCE) return node.id;
            }
            const id = nodeId++;
            nodes.push({ id, x, y });
            idToCoord.set(id, [x, y]);
            graph.set(id, []);
            return id;
        };
        
        this.paths.forEach(path => {
            const id1 = getNodeId(path.x1, path.y1);
            const id2 = getNodeId(path.x2, path.y2);
            if (id1 === id2) return;
            const dist = Math.sqrt(Math.pow(path.x2 - path.x1, 2) + Math.pow(path.y2 - path.y1, 2));
            if (!graph.get(id1).find(e => e.node === id2)) {
                graph.get(id1).push({ node: id2, dist });
            }
            if (!graph.get(id2).find(e => e.node === id1)) {
                graph.get(id2).push({ node: id1, dist });
            }
        });
        
        console.log(`Toplam düğüm: ${nodes.length}, Path segmenti: ${this.paths.length}`);
        
        // Bağlantısız bileşenleri bul
        const visited = new Set();
        const components = [];
        
        for (const node of nodes) {
            if (visited.has(node.id)) continue;
            
            const component = [];
            const queue = [node.id];
            visited.add(node.id);
            
            while (queue.length > 0) {
                const current = queue.shift();
                component.push(current);
                for (const edge of graph.get(current) || []) {
                    if (!visited.has(edge.node)) {
                        visited.add(edge.node);
                        queue.push(edge.node);
                    }
                }
            }
            
            // Bileşenin sınırlarını hesapla
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            component.forEach(nId => {
                const coord = idToCoord.get(nId);
                if (coord) {
                    minX = Math.min(minX, coord[0]);
                    maxX = Math.max(maxX, coord[0]);
                    minY = Math.min(minY, coord[1]);
                    maxY = Math.max(maxY, coord[1]);
                }
            });
            
            components.push({
                size: component.length,
                bounds: { minX, maxX, minY, maxY },
                nodes: component
            });
        }
        
        // Bileşenleri boyuta göre sırala
        components.sort((a, b) => b.size - a.size);
        
        console.log(`\nBağlantısız bileşen sayısı: ${components.length}`);
        components.forEach((comp, idx) => {
            console.log(`  Bileşen ${idx + 1}: ${comp.size} düğüm, X[${comp.bounds.minX.toFixed(0)}-${comp.bounds.maxX.toFixed(0)}], Y[${comp.bounds.minY.toFixed(0)}-${comp.bounds.maxY.toFixed(0)}]`);
        });
        
        // Odaların hangi bileşende olduğunu kontrol et
        console.log(`\nÖrnek odaların bileşenleri:`);
        const testRooms = ['ID235', 'ID220A', 'ID200', 'ID201'];
        testRooms.forEach(roomId => {
            const room = this.rooms.find(r => r.id === roomId);
            if (!room) return;
            
            // En yakın düğümü bul
            let nearestNodeId = null;
            let nearestDist = Infinity;
            for (const node of nodes) {
                const dist = Math.sqrt(Math.pow(node.x - room.center[0], 2) + Math.pow(node.y - room.center[1], 2));
                if (dist < nearestDist) {
                    nearestDist = dist;
                    nearestNodeId = node.id;
                }
            }
            
            // Hangi bileşende
            const compIdx = components.findIndex(c => c.nodes.includes(nearestNodeId));
            console.log(`  ${roomId}: Bileşen ${compIdx + 1}, mesafe ${nearestDist.toFixed(1)}`);
        });
        
        return components;
    }

    /**
     * Kat içindeki tüm Stop'ların durumunu göster
     */
    debugStops(floorId) {
        const floorData = this.floors.get(floorId);
        if (!floorData) {
            console.error(`Kat ${floorId} bulunamadı`);
            return;
        }
        
        console.log(`\n=== Kat ${floorId} Stop Durumu ===`);
        
        if (!floorData.stopTeleports || floorData.stopTeleports.length === 0) {
            console.log('Bu katta Stop yok');
            return;
        }
        
        floorData.stopTeleports.forEach(stop => {
            console.log(`Stop.${stop.stopNumber}:`);
            console.log(`  A: center=${JSON.stringify(stop.A?.center)}, lineCoords=${JSON.stringify(stop.A?.lineCoords)}, status=${stop.A?.Status}`);
            console.log(`  B: center=${JSON.stringify(stop.B?.center)}, lineCoords=${JSON.stringify(stop.B?.lineCoords)}, status=${stop.B?.Status}`);
            console.log(`  A->B: ${stop.aToB}, B->A: ${stop.bToA}`);
        });
    }
}
