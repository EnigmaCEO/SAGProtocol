// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

contract ExecutionRouteRegistry is Ownable {
    enum RouteType {
        Onchain,
        Custodian,
        ManagedPortfolio,
        External
    }

    struct Route {
        uint256 routeId;
        string assetSymbol;
        RouteType routeType;
        bytes32 counterpartyRefHash;
        bytes32 jurisdictionRefHash;
        bytes32 custodyRefHash;
        bool documentsComplete;
        bool sagittaFundApproved;
        bool ndaSigned;
        string pnlEndpoint;
        bool manualMarksRequired;
        bool active;
    }

    uint256 public nextRouteId;
    uint256[] private routeIds;
    mapping(uint256 => Route) private routes;

    event RouteAdded(uint256 indexed routeId, string assetSymbol, RouteType routeType, bool active);
    event RouteUpdated(uint256 indexed routeId, string assetSymbol, RouteType routeType, bool active);
    event RouteRemoved(uint256 indexed routeId);

    constructor() Ownable(msg.sender) {
        nextRouteId = 1;
    }

    function addRoute(
        string calldata assetSymbol,
        RouteType routeType,
        bytes32 counterpartyRefHash,
        bytes32 jurisdictionRefHash,
        bytes32 custodyRefHash,
        bool documentsComplete,
        bool sagittaFundApproved,
        bool ndaSigned,
        string calldata pnlEndpoint,
        bool manualMarksRequired,
        bool active
    ) external onlyOwner returns (uint256 routeId) {
        require(bytes(assetSymbol).length > 0, "Empty asset symbol");

        routeId = nextRouteId++;
        routes[routeId] = Route({
            routeId: routeId,
            assetSymbol: assetSymbol,
            routeType: routeType,
            counterpartyRefHash: counterpartyRefHash,
            jurisdictionRefHash: jurisdictionRefHash,
            custodyRefHash: custodyRefHash,
            documentsComplete: documentsComplete,
            sagittaFundApproved: sagittaFundApproved,
            ndaSigned: ndaSigned,
            pnlEndpoint: pnlEndpoint,
            manualMarksRequired: manualMarksRequired,
            active: active
        });
        routeIds.push(routeId);

        emit RouteAdded(routeId, assetSymbol, routeType, active);
    }

    function updateRoute(
        uint256 routeId,
        string calldata assetSymbol,
        RouteType routeType,
        bytes32 counterpartyRefHash,
        bytes32 jurisdictionRefHash,
        bytes32 custodyRefHash,
        bool documentsComplete,
        bool sagittaFundApproved,
        bool ndaSigned,
        string calldata pnlEndpoint,
        bool manualMarksRequired,
        bool active
    ) external onlyOwner {
        require(routeExists(routeId), "Route missing");
        require(bytes(assetSymbol).length > 0, "Empty asset symbol");

        routes[routeId] = Route({
            routeId: routeId,
            assetSymbol: assetSymbol,
            routeType: routeType,
            counterpartyRefHash: counterpartyRefHash,
            jurisdictionRefHash: jurisdictionRefHash,
            custodyRefHash: custodyRefHash,
            documentsComplete: documentsComplete,
            sagittaFundApproved: sagittaFundApproved,
            ndaSigned: ndaSigned,
            pnlEndpoint: pnlEndpoint,
            manualMarksRequired: manualMarksRequired,
            active: active
        });

        emit RouteUpdated(routeId, assetSymbol, routeType, active);
    }

    function removeRoute(uint256 routeId) external onlyOwner {
        require(routeExists(routeId), "Route missing");
        delete routes[routeId];

        uint256 len = routeIds.length;
        for (uint256 i = 0; i < len; i++) {
            if (routeIds[i] == routeId) {
                routeIds[i] = routeIds[len - 1];
                routeIds.pop();
                break;
            }
        }

        emit RouteRemoved(routeId);
    }

    function routeExists(uint256 routeId) public view returns (bool) {
        return routes[routeId].routeId == routeId;
    }

    function getRoute(uint256 routeId) external view returns (
        uint256 id,
        string memory assetSymbol,
        RouteType routeType,
        bytes32 counterpartyRefHash,
        bytes32 jurisdictionRefHash,
        bytes32 custodyRefHash,
        bool documentsComplete,
        bool sagittaFundApproved,
        bool ndaSigned,
        string memory pnlEndpoint,
        bool manualMarksRequired,
        bool active
    ) {
        require(routeExists(routeId), "Route missing");
        Route storage route = routes[routeId];
        return (
            route.routeId,
            route.assetSymbol,
            route.routeType,
            route.counterpartyRefHash,
            route.jurisdictionRefHash,
            route.custodyRefHash,
            route.documentsComplete,
            route.sagittaFundApproved,
            route.ndaSigned,
            route.pnlEndpoint,
            route.manualMarksRequired,
            route.active
        );
    }

    function isRouteBatchEligible(uint256 routeId) external view returns (bool) {
        require(routeExists(routeId), "Route missing");
        Route storage route = routes[routeId];
        if (!route.active) {
            return false;
        }
        if (route.routeType != RouteType.External) {
            return true;
        }
        return route.documentsComplete
            && route.sagittaFundApproved
            && route.ndaSigned
            && bytes(route.pnlEndpoint).length > 0;
    }

    function getComplianceStatus(uint256 routeId) external view returns (
        bool documentsComplete,
        bool sagittaFundApproved,
        bool ndaSigned,
        bool hasPnlEndpoint,
        bool batchEligible,
        string memory pnlEndpoint
    ) {
        require(routeExists(routeId), "Route missing");
        Route storage route = routes[routeId];
        documentsComplete = route.documentsComplete;
        sagittaFundApproved = route.sagittaFundApproved;
        ndaSigned = route.ndaSigned;
        hasPnlEndpoint = bytes(route.pnlEndpoint).length > 0;
        pnlEndpoint = route.pnlEndpoint;
        if (!route.active) {
            batchEligible = false;
        } else if (route.routeType != RouteType.External) {
            batchEligible = true;
        } else {
            batchEligible = documentsComplete && sagittaFundApproved && ndaSigned && hasPnlEndpoint;
        }
    }

    function getRouteIds() external view returns (uint256[] memory) {
        return routeIds;
    }

    function getAllRoutes() external view returns (Route[] memory result) {
        uint256 len = routeIds.length;
        result = new Route[](len);
        for (uint256 i = 0; i < len; i++) {
            result[i] = routes[routeIds[i]];
        }
    }
}
